import { db, ref, onValue, set, push, auth, onAuthStateChanged } from './config.js';

const resourceImages = {
    pdf: 'images/courses.jpg',
    training: 'images/training.jpg',
    course: 'images/courses.jpg'
};

const searchInput = document.getElementById('searchInput');
const resourceGrid = document.getElementById('resourceGrid');
const tabButtons = document.querySelectorAll('.tab-button');
const requestNewResourceBtn = document.getElementById('requestNewResourceBtn');
const requestModal = document.getElementById('requestModal');
const requestForm = document.getElementById('requestForm');
const notificationButton = document.getElementById('notificationButton');
const profileButton = document.getElementById('profileButton');
const profileModal = document.getElementById('profileModal');
const profileContent = document.getElementById('profileContent');
const userNameElement = document.getElementById('userName');
const prevPage = document.getElementById('prevPage');
const nextPage = document.getElementById('nextPage');
const pageInfo = document.getElementById('pageInfo');

let notifications = [];
let currentPage = 1;
const itemsPerPage = 12;

// Create notifications panel dynamically
const notificationsPanel = document.createElement('div');
notificationsPanel.id = 'notificationsPanel';
notificationsPanel.className = 'notifications-panel hidden absolute top-16 right-4 bg-white rounded-lg shadow-lg w-80';
notificationsPanel.innerHTML = `
    <div class="p-4 border-b">
        <h3 class="text-lg font-semibold">Notifications</h3>
    </div>
    <div class="notifications-list max-h-64 overflow-y-auto"></div>
    <div class="p-4 border-t">
        <button class="clear-all-button text-blue-600 hover:underline w-full text-center">Clear All</button>
    </div>
`;
document.body.appendChild(notificationsPanel);

function createResourceCard(resource, isRequest = false) {
    const statusClass = (resource.status || 'available').toLowerCase();
    let actions = '';
    if (!isRequest && statusClass === 'available') {
        actions = `<button class="action-button request">Request</button>`;
    } else if (isRequest) {
        if (statusClass === 'pending' || statusClass === 'rejected') {
            actions = `<button class="action-button cancel">Cancel</button>`;
        } else if (statusClass === 'approved') {
            // Only show the button if the appropriate URL exists
            if ((resource.type === 'pdf' && resource.fileUrl) || 
                ((resource.type === 'course' || resource.type === 'training') && resource.resourceLink)) {
                const buttonLabel = resource.type === 'pdf' ? 'Download PDF' : 'Access Link';
                const buttonClass = resource.type === 'pdf' ? 'download-pdf' : 'access-link';
                const buttonTitle = resource.type === 'pdf' ? 'Open PDF in new tab' : 'Visit course/training link';
                actions = `
                    <button class="action-button ${buttonClass}" 
                            data-type="${resource.type}" 
                            data-file-url="${resource.fileUrl || ''}" 
                            data-resource-link="${resource.resourceLink || ''}"
                            title="${buttonTitle}">
                        ${buttonLabel}
                    </button>`;
            }
        }
    }
    return `
        <div class="resource-card bg-white rounded-lg shadow-md" data-id="${resource.id}">
            <img src="${resourceImages[resource.type]}" alt="${resource.type}" class="resource-image">
            <div class="resource-content">
                <h3 class="resource-title">${resource.title}</h3>
                <p class="resource-description">${resource.description}</p>
                <div class="resource-footer">
                    <span class="resource-type">${resource.type}</span>
                    <span class="status-badge ${statusClass}">${isRequest ? resource.status : 'Available'}</span>
                </div>
                <div class="mt-2">${actions}</div>
            </div>
        </div>
    `;
}

function fetchData(path, callback) {
    const dataRef = ref(db, path);
    onValue(dataRef, (snapshot) => {
        const data = snapshot.val();
        const dataArray = data ? Object.keys(data).map(key => ({ id: key, ...data[key] })) : [];
        callback(dataArray);
    });
}

// Add a new function to fetch data once as a promise
async function fetchDataOnce(path) {
    return new Promise((resolve, reject) => {
        const dataRef = ref(db, path);
        onValue(dataRef, (snapshot) => {
            const data = snapshot.val();
            const dataArray = data ? Object.keys(data).map(key => ({ id: key, ...data[key] })) : [];
            resolve(dataArray);
        }, (error) => {
            reject(error);
        }, { onlyOnce: true });
    });
}

async function fetchUserDataOnce(userId) {
    return new Promise((resolve) => {
        const userRef = ref(db, `users/${userId}`);
        onValue(userRef, (snapshot) => resolve(snapshot.val()), { onlyOnce: true });
    });
}

function renderResources(searchTerm = '') {
    const activeTab = document.querySelector('.tab-button.active')?.dataset.tab;
    const searchLower = searchTerm.toLowerCase();
    const user = auth.currentUser;

    if (!user) {
        resourceGrid.innerHTML = '<div class="col-span-full text-center p-6 bg-white rounded-lg shadow-md"><p class="text-gray-600">Please log in to view resources.</p></div>';
        return;
    }

    if (activeTab === 'resources') {
        fetchData('resources', (resources) => {
            let displayResources = resources.filter(r =>
                r.status === 'available' &&
                (r.title.toLowerCase().includes(searchLower) || r.description.toLowerCase().includes(searchLower))
            );
            const totalItems = displayResources.length;
            const totalPages = Math.ceil(totalItems / itemsPerPage);
            const startIndex = (currentPage - 1) * itemsPerPage;
            const paginatedResources = displayResources.slice(startIndex, startIndex + itemsPerPage);

            resourceGrid.innerHTML = paginatedResources.length
                ? paginatedResources.map(r => createResourceCard(r)).join('')
                : '<div class="col-span-full text-center p-6 bg-white rounded-lg shadow-md"><p class="text-gray-600">No resources found.</p></div>';

            updatePagination(totalPages);
        });
    } else if (activeTab === 'requests') {
        fetchData('requests', (requests) => {
            // Filter requests for the current user
            let userRequests = requests.filter(r => r.studentId === user.uid);

            // Group requests by title (since resourceId might not be unique across requests)
            const groupedRequests = {};
            userRequests.forEach(request => {
                const key = request.title; // Group by title
                if (!groupedRequests[key]) {
                    groupedRequests[key] = [];
                }
                groupedRequests[key].push(request);
            });

            // For each group, select the request with the most recent status
            const latestRequests = Object.values(groupedRequests).map(group => {
                // Sort by status priority: approved > rejected > pending
                return group.sort((a, b) => {
                    const statusPriority = { approved: 3, rejected: 2, pending: 1 };
                    return statusPriority[b.status] - statusPriority[a.status];
                })[0]; // Take the highest priority status
            });

            // Filter by search term
            const filteredRequests = latestRequests.filter(r =>
                r.title.toLowerCase().includes(searchLower) || 
                r.description.toLowerCase().includes(searchLower)
            );

            // Paginate the filtered requests
            const totalItems = filteredRequests.length;
            const totalPages = Math.ceil(totalItems / itemsPerPage);
            const startIndex = (currentPage - 1) * itemsPerPage;
            const paginatedRequests = filteredRequests.slice(startIndex, startIndex + itemsPerPage);

            resourceGrid.innerHTML = paginatedRequests.length
                ? paginatedRequests.map(r => createResourceCard(r, true)).join('')
                : '<div class="col-span-full text-center p-6 bg-white rounded-lg shadow-md"><p class="text-gray-600">You have no requests.</p></div>';

            updatePagination(totalPages);
        });
    }
}

function updatePagination(totalPages) {
    pageInfo.textContent = `Page ${currentPage} of ${totalPages || 1}`;
    prevPage.disabled = currentPage === 1;
    nextPage.disabled = currentPage === totalPages || totalPages === 0;
}

async function sendNotificationToAdmin(studentId, title, message) {
    const notificationsRef = ref(db, 'adminNotifications');
    const newNotificationRef = push(notificationsRef);
    const notificationData = {
        title,
        message,
        timestamp: new Date().toISOString(),
        studentId,
        read: false,
        customRequestId: newNotificationRef.key
    };
    try {
        await set(newNotificationRef, notificationData);
        console.log(`[sendNotificationToAdmin] Notification sent: ${title} - ${message}`);
    } catch (error) {
        console.error('[sendNotificationToAdmin] Error sending notification to admin:', error);
    }
}

function addNotification(message) {
    const notification = document.createElement('div');
    notification.className = 'notification';
    notification.textContent = message;
    document.body.appendChild(notification);
    setTimeout(() => notification.remove(), 3000);
}

function updateNotifications() {
    const unreadCount = notifications.filter(n => !n.read).length;
    const badge = document.querySelector('.notification-badge');
    badge.textContent = unreadCount;
    badge.style.display = unreadCount ? 'flex' : 'none';
    const notificationsList = notificationsPanel.querySelector('.notifications-list');
    notificationsList.innerHTML = notifications.length
        ? notifications.map(n => `
            <div class="notification-item" data-id="${n.id}">
                <div class="notification-header">
                    <span class="notification-title">${n.title}</span>
                    <span class="notification-time">${new Date(n.timestamp).toLocaleTimeString()}</span>
                </div>
                <p class="notification-message">${n.message}</p>
            </div>
        `).join('')
        : '<p class="text-center text-gray-500 p-4">No notifications</p>';
}

function listenForNotifications(studentId) {
    const notificationsRef = ref(db, `studentNotifications/${studentId}`);
    onValue(notificationsRef, (snapshot) => {
        const data = snapshot.val();
        notifications = data ? Object.entries(data).map(([id, value]) => ({ id, ...value })) : [];
        updateNotifications();
    });

    const resourcesRef = ref(db, 'resources');
    onValue(resourcesRef, (snapshot) => {
        const resources = snapshot.val();
        if (resources) {
            const newResources = Object.entries(resources).map(([id, value]) => ({ id, ...value }));
            newResources.forEach(resource => {
                if (resource.createdAt && new Date(resource.createdAt) > new Date(Date.now() - 60000)) {
                    notifications.push({
                        id: Date.now(),
                        title: 'New Resource',
                        message: `${resource.title} has been added.`,
                        timestamp: new Date().toISOString(),
                        read: false
                    });
                    addNotification(`New resource added: ${resource.title}`);
                    updateNotifications();
                }
            });
        }
    });
}

function initDashboard(user) {
    const displayName = user.displayName || user.email.split('@')[0] || 'User';
    userNameElement.textContent = `Hello, ${displayName.toUpperCase()}`;
    renderResources();
    listenForNotifications(user.uid);

    searchInput.addEventListener('input', (e) => {
        currentPage = 1;
        renderResources(e.target.value);
    });

    tabButtons.forEach(btn => {
        btn.addEventListener('click', () => {
            tabButtons.forEach(b => b.classList.remove('active', 'text-blue-600', 'border-blue-600'));
            btn.classList.add('active', 'text-blue-600', 'border-blue-600');
            currentPage = 1;
            searchInput.value = '';
            renderResources();
        });
    });

    prevPage.addEventListener('click', () => {
        if (currentPage > 1) {
            currentPage--;
            renderResources(searchInput.value);
        }
    });

    nextPage.addEventListener('click', () => {
        currentPage++;
        renderResources(searchInput.value);
    });

    requestNewResourceBtn.addEventListener('click', () => requestModal.classList.add('active'));

    requestModal.querySelector('.close-button').addEventListener('click', () => {
        requestModal.classList.remove('active');
        requestForm.reset();
    });

    requestModal.querySelector('[data-action="cancel"]').addEventListener('click', () => {
        requestModal.classList.remove('active');
        requestForm.reset();
    });

    requestForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const formData = new FormData(requestForm);
        const requestData = {
            title: formData.get('title'),
            type: formData.get('type'),
            description: formData.get('description'),
            studentId: user.uid,
            status: 'pending',
            createdAt: new Date().toISOString()
        };

        try {
            const requestsRef = ref(db, 'customRequests');
            const newRequestRef = push(requestsRef);
            await set(newRequestRef, requestData);
            await sendNotificationToAdmin(user.uid, 'New Resource Request', `${requestData.title} requested by ${user.email}`);
            addNotification('Request submitted successfully!');
            requestModal.classList.remove('active');
            requestForm.reset();
            renderResources();
        } catch (error) {
            console.error('Error submitting request:', error);
            addNotification('Failed to submit request.');
        }
    });

    profileButton.addEventListener('click', async () => {
        const userData = await fetchUserDataOnce(user.uid);
        profileContent.innerHTML = `
            <p><strong>Email:</strong> ${user.email}</p>
            <p><strong>Role:</strong> ${userData.role || 'Student'}</p>
            ${userData.displayName ? `<p><strong>Name:</strong> ${userData.displayName}</p>` : ''}
        `;
        profileModal.classList.add('active');
    });

    profileModal.querySelector('.close-button').addEventListener('click', () => {
        profileModal.classList.remove('active');
    });

    resourceGrid.addEventListener('click', async (e) => {
        const card = e.target.closest('.resource-card');
        if (!card) return;
        const resourceId = card.dataset.id;

        if (e.target.classList.contains('request')) {
            fetchData('resources', async (resources) => {
                const resource = resources.find(r => r.id === resourceId);
                if (!resource) return;
                const requestData = {
                    ...resource,
                    studentId: user.uid,
                    status: 'pending',
                    createdAt: new Date().toISOString()
                };
                const requestsRef = ref(db, 'requests');
                const newRequestRef = push(requestsRef);
                await set(newRequestRef, requestData);
                await sendNotificationToAdmin(user.uid, 'Resource Request', `${resource.title} requested by ${user.email}`);
                addNotification('Resource requested successfully!');
                renderResources();
            });
        } else if (e.target.classList.contains('cancel')) {
            console.log(`[Cancel] Initiating cancellation for request ID: ${resourceId}`);

            try {
                // Fetch the request to verify it exists and belongs to the user
                const requests = await fetchDataOnce('requests');
                const request = requests.find(r => r.id === resourceId);

                if (!request) {
                    console.error(`[Cancel] Request with ID ${resourceId} not found in Firebase`);
                    addNotification('Request not found.');
                    return;
                }

                if (request.studentId !== user.uid) {
                    console.error(`[Cancel] User ${user.uid} is not authorized to cancel request ${resourceId} (owned by ${request.studentId})`);
                    addNotification('You are not authorized to cancel this request.');
                    return;
                }

                console.log(`[Cancel] Found request:`, request);

                // Attempt to delete the request from Firebase
                const requestRef = ref(db, `requests/${resourceId}`);
                await set(requestRef, null);
                console.log(`[Cancel] Successfully deleted request ${resourceId} from Firebase`);

                // Notify admin about the cancellation
                await sendNotificationToAdmin(
                    user.uid,
                    'Request Cancelled',
                    `${request.title} request cancelled by ${user.email}`
                );

                // Remove the card from the UI and notify the user
                card.remove();
                addNotification('Request cancelled successfully!');
            } catch (error) {
                console.error(`[Cancel] Failed to delete request ${resourceId} from Firebase:`, error);
                addNotification('Failed to cancel request. Please try again.');
            }
        } else if (e.target.classList.contains('download-pdf') || e.target.classList.contains('access-link')) {
            const type = e.target.dataset.type;
            const fileUrl = e.target.dataset.fileUrl;
            const resourceLink = e.target.dataset.resourceLink;

            // Add loading state
            const originalText = e.target.textContent;
            e.target.textContent = 'Loading...';
            e.target.disabled = true;

            try {
                if (type === 'pdf' && fileUrl) {
                    console.log(`[Download] Initiating PDF download for ${fileUrl}`);
                    window.open(fileUrl, '_blank');
                } else if ((type === 'course' || type === 'training') && resourceLink) {
                    console.log(`[Download] Redirecting to ${resourceLink}`);
                    window.open(resourceLink, '_blank');
                } else {
                    console.error('[Download] Invalid data for resource:', resourceId, { type, fileUrl, resourceLink });
                    addNotification('Resource not available for download.');
                }
            } finally {
                // Reset button state after a short delay
                setTimeout(() => {
                    e.target.textContent = originalText;
                    e.target.disabled = false;
                }, 1000);
            }
        }
    });

    notificationButton.addEventListener('click', () => {
        notificationsPanel.classList.toggle('hidden');
        notifications.forEach(n => n.read = true);
        updateNotifications();
    });

    notificationsPanel.querySelector('.clear-all-button').addEventListener('click', () => {
        notifications = [];
        updateNotifications();
    });

    document.addEventListener('click', (e) => {
        if (!notificationsPanel.contains(e.target) && !notificationButton.contains(e.target)) {
            notificationsPanel.classList.add('hidden');
        }
    });
}

onAuthStateChanged(auth, (user) => {
    if (user) {
        initDashboard(user);
    } else {
        window.location.href = 'login.html';
    }
});

document.addEventListener('DOMContentLoaded', () => {
    const logoutBtn = document.querySelector('a[onclick="handleLogout()"]');
    logoutBtn?.addEventListener('click', async (e) => {
        e.preventDefault();
        if (confirm('Do you want to logout?')) {
            try {
                await auth.signOut();
                window.location.href = 'login.html';
            } catch (error) {
                console.error('Error logging out:', error);
            }
        }
    });
});