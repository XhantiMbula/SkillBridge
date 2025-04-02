import { db, ref, onValue, set, push, storage, storageRef, uploadBytes, getDownloadURL, auth, onAuthStateChanged } from './config.js';

const searchInput = document.getElementById('searchInput');
const resourceTableBody = document.getElementById('resourceTableBody');
const tabButtons = document.querySelectorAll('.tab-button');
const addResourceBtn = document.getElementById('addResourceBtn');
const resourceModal = document.getElementById('resourceModal');
const resourceForm = document.getElementById('resourceForm');
const notificationButton = document.getElementById('notificationButton');
const notificationsPanel = document.getElementById('notificationsPanel');
const notificationsList = document.querySelector('.notifications-list');
const notificationBadge = document.querySelector('.notification-badge');
const totalRequestsEl = document.getElementById('totalRequests');
const pendingRequestsEl = document.getElementById('pendingRequests');
const approvedRequestsEl = document.getElementById('approvedRequests');
const rejectedRequestsEl = document.getElementById('rejectedRequests');
const barChartCanvas = document.getElementById('barChart');
const pieChartCanvas = document.getElementById('pieChart');

let barChart, pieChart;
let notifications = [];
let isEditing = false;
let editingResourceId = null;
let cachedUsers = {};

const logError = (message, error) => console.error(`[AdminDash] ${message}:`, error);

const fetchDataRealTime = (path, callback) => {
    const dataRef = ref(db, path);
    onValue(dataRef, (snapshot) => {
        const data = snapshot.val();
        const dataArray = data ? Object.entries(data).map(([id, value]) => ({ id, ...value })) : [];
        console.log(`[fetchDataRealTime] ${path}:`, dataArray);
        callback(dataArray);
    }, (error) => {
        logError(`Failed to fetch ${path}`, error);
        callback([]); // Fallback to empty array to prevent breaking the UI
    });
};

const fetchDataOnce = (path) => {
    return new Promise((resolve, reject) => {
        const dataRef = ref(db, path);
        onValue(dataRef, (snapshot) => {
            const data = snapshot.val();
            const dataArray = data ? Object.entries(data).map(([id, value]) => ({ id, ...value })) : [];
            resolve(dataArray);
        }, { onlyOnce: true }, (error) => reject(error));
    });
};

const debounce = (func, wait) => {
    let timeout;
    return (...args) => {
        return new Promise((resolve) => {
            clearTimeout(timeout);
            timeout = setTimeout(async () => {
                const result = await func(...args);
                resolve(result);
            }, wait);
        });
    };
};

const createResourceRow = (resource) => `
    <tr data-id="${resource.id}">
        <td>${resource.title}</td>
        <td>${resource.type}</td>
        <td>${resource.description}</td>
        <td>--</td>
        <td>--</td>
        <td>
            <button class="action-button edit">Edit</button>
            <button class="action-button delete">Delete</button>
        </td>
    </tr>
`;

const createRequestRow = async (request) => {
    const statusClass = request.status.toLowerCase();
    let actions = '';
    if (statusClass === 'pending') {
        actions = `
            <button class="action-button approve">Approve</button>
            <button class="action-button reject">Reject</button>
        `;
    }

    let studentEmail = '--';
    try {
        const userData = await fetchUserData(request.studentId);
        studentEmail = userData.email || '--';
    } catch (error) {
        logError(`Failed to fetch user data for studentId ${request.studentId}`, error);
    }

    return `
        <tr data-id="${request.id}">
            <td>${request.title || 'Untitled'}</td>
            <td>${request.type || 'Unknown'}</td>
            <td>${request.description || 'No description'}</td>
            <td>${studentEmail}</td>
            <td><span class="status-badge ${statusClass}">${request.status}</span></td>
            <td>${actions}</td>
        </tr>
    `;
};

const fetchUserData = async (userId) => {
    if (cachedUsers[userId]) {
        console.log(`[fetchUserData] Returning cached user data for userId ${userId}:`, cachedUsers[userId]);
        return cachedUsers[userId];
    }
    const userRef = ref(db, `users/${userId}`);
    return new Promise((resolve, reject) => {
        onValue(userRef, (snapshot) => {
            const userData = snapshot.val() || {};
            cachedUsers[userId] = userData;
            console.log(`[fetchUserData] Fetched user data for userId ${userId}:`, userData);
            resolve(userData);
        }, (error) => {
            console.error(`[fetchUserData] Failed to fetch user data for userId ${userId}:`, error);
            reject(error);
        }, { onlyOnce: true });
    });
};

const renderTable = debounce(async (searchTerm = '') => {
    console.log('[renderTable] Starting renderTable with searchTerm:', searchTerm);

    const activeTab = document.querySelector('.tab-button.active')?.dataset.tab;
    if (!activeTab) {
        console.error('[renderTable] No active tab found');
        if (resourceTableBody) {
            resourceTableBody.innerHTML = '<tr><td colspan="6" class="text-center p-4">Error: No active tab selected.</td></tr>';
        } else {
            console.error('[renderTable] resourceTableBody element not found');
        }
        return;
    }
    const searchLower = searchTerm.toLowerCase();

    fetchDataRealTime('requests', async (requests) => {
        console.log('[renderTable] All requests:', requests);

        let htmlContent = '';
        try {
            if (activeTab === 'pending') {
                const filtered = requests.filter(r => 
                    r.status === 'pending' && 
                    (r.title?.toLowerCase().includes(searchLower) || 
                     r.description?.toLowerCase().includes(searchLower))
                );
                console.log('[renderTable] Filtered pending requests:', filtered);
                htmlContent = filtered.length
                    ? (await Promise.all(filtered.map(async (request) => {
                        try {
                            return await createRequestRow(request);
                        } catch (error) {
                            console.error(`[renderTable] Error in createRequestRow for request ${request.id}:`, error);
                            return `<tr data-id="${request.id}"><td colspan="6">Error loading request</td></tr>`;
                        }
                    }))).join('')
                    : '<tr><td colspan="6" class="text-center p-4">No pending requests found.</td></tr>';
            } else if (activeTab === 'approved') {
                const filtered = requests.filter(r => 
                    r.status === 'approved' && 
                    (r.title?.toLowerCase().includes(searchLower) || 
                     r.description?.toLowerCase().includes(searchLower))
                );
                console.log('[renderTable] Filtered approved requests:', filtered);
                htmlContent = filtered.length
                    ? (await Promise.all(filtered.map(async (request) => {
                        try {
                            return await createRequestRow(request);
                        } catch (error) {
                            console.error(`[renderTable] Error in createRequestRow for request ${request.id}:`, error);
                            return `<tr data-id="${request.id}"><td colspan="6">Error loading request</td></tr>`;
                        }
                    }))).join('')
                    : '<tr><td colspan="6" class="text-center p-4">No approved requests found.</td></tr>';
            } else if (activeTab === 'rejected') {
                const filtered = requests.filter(r => 
                    r.status === 'rejected' && 
                    (r.title?.toLowerCase().includes(searchLower) || 
                     r.description?.toLowerCase().includes(searchLower))
                );
                console.log('[renderTable] Filtered rejected requests:', filtered);
                htmlContent = filtered.length
                    ? (await Promise.all(filtered.map(async (request) => {
                        try {
                            return await createRequestRow(request);
                        } catch (error) {
                            console.error(`[renderTable] Error in createRequestRow for request ${request.id}:`, error);
                            return `<tr data-id="${request.id}"><td colspan="6">Error loading request</td></tr>`;
                        }
                    }))).join('')
                    : '<tr><td colspan="6" class="text-center p-4">No rejected requests found.</td></tr>';
            } else if (activeTab === 'all') {
                fetchDataRealTime('resources', (resources) => {
                    const filtered = resources.filter(r =>
                        r.title.toLowerCase().includes(searchLower) ||
                        r.description.toLowerCase().includes(searchLower)
                    );
                    console.log('[renderTable] Filtered resources:', filtered);
                    htmlContent = filtered.length
                        ? filtered.map(createResourceRow).join('')
                        : '<tr><td colspan="6" class="text-center p-4">No resources found.</td></tr>';
                    if (resourceTableBody) {
                        resourceTableBody.innerHTML = htmlContent;
                        console.log('[renderTable] Set HTML for all tab:', htmlContent);
                    } else {
                        console.error('[renderTable] resourceTableBody element not found');
                    }
                });
                return;
            }

            if (resourceTableBody) {
                resourceTableBody.innerHTML = htmlContent;
                console.log(`[renderTable] Set HTML for ${activeTab} tab:`, htmlContent);
            } else {
                console.error('[renderTable] resourceTableBody element not found');
            }
        } catch (error) {
            console.error('[renderTable] Error rendering table:', error);
            if (resourceTableBody) {
                resourceTableBody.innerHTML = '<tr><td colspan="6" class="text-center p-4">Error loading requests. Please try again.</td></tr>';
            } else {
                console.error('[renderTable] resourceTableBody element not found');
            }
        }
    });
}, 100);

const updateStatsAndCharts = () => {
    fetchDataRealTime('requests', (requests) => {
        fetchDataRealTime('resources', (resources) => {
            const totalRequests = requests.length;
            const pendingRequests = requests.filter(r => r.status.toLowerCase() === 'pending').length;
            const approvedRequests = requests.filter(r => r.status.toLowerCase() === 'approved').length;
            const rejectedRequests = requests.filter(r => r.status.toLowerCase() === 'rejected').length;

            if (totalRequestsEl) {
                totalRequestsEl.textContent = totalRequests;
            } else {
                console.error('[updateStatsAndCharts] Element with ID "totalRequests" not found in the DOM');
            }
            if (pendingRequestsEl) {
                pendingRequestsEl.textContent = pendingRequests;
            } else {
                console.error('[updateStatsAndCharts] Element with ID "pendingRequests" not found in the DOM');
            }
            if (approvedRequestsEl) {
                approvedRequestsEl.textContent = approvedRequests;
            } else {
                console.error('[updateStatsAndCharts] Element with ID "approvedRequests" not found in the DOM');
            }
            if (rejectedRequestsEl) {
                rejectedRequestsEl.textContent = rejectedRequests;
            } else {
                console.error('[updateStatsAndCharts] Element with ID "rejectedRequests" not found in the DOM');
            }

            const requestCounts = {};
            requests.forEach(request => {
                const resource = resources.find(r => r.id === request.resourceId) || { title: request.title || 'Unknown' };
                requestCounts[resource.title] = (requestCounts[resource.title] || 0) + 1;
            });

            if (barChart) barChart.destroy();
            if (pieChart) pieChart.destroy();

            if (barChartCanvas) {
                barChart = new Chart(barChartCanvas, {
                    type: 'bar',
                    data: {
                        labels: Object.keys(requestCounts),
                        datasets: [{
                            label: 'Requests',
                            data: Object.values(requestCounts),
                            backgroundColor: '#60a5fa',
                        }]
                    },
                    options: { scales: { y: { beginAtZero: true } } }
                });
            } else {
                console.error('[updateStatsAndCharts] Element with ID "barChart" not found in the DOM');
            }

            if (pieChartCanvas) {
                pieChart = new Chart(pieChartCanvas, {
                    type: 'pie',
                    data: {
                        labels: Object.keys(requestCounts),
                        datasets: [{
                            data: Object.values(requestCounts),
                            backgroundColor: ['#60a5fa', '#34d399', '#f87171', '#fbbf24', '#a78bfa'],
                        }]
                    },
                    options: { responsive: true }
                });
            } else {
                console.error('[updateStatsAndCharts] Element with ID "pieChart" not found in the DOM');
            }
        });
    });
};

const addNotification = (title, message) => {
    const time = new Date();
    notifications.unshift({ id: Date.now(), title, message, time, read: false });
    console.log('[addNotification] Added:', { title, message, time });
    updateNotifications();
};

const updateNotifications = () => {
    const unreadCount = notifications.filter(n => !n.read).length;
    if (notificationBadge) {
        notificationBadge.textContent = unreadCount;
        notificationBadge.style.display = unreadCount ? 'flex' : 'none';
    } else {
        console.error('[updateNotifications] notificationBadge element not found');
    }
    if (notificationsList) {
        notificationsList.innerHTML = notifications.length
            ? notifications.map(n => `
                <div class="notification-item" data-id="${n.id}">
                    <div class="notification-header">
                        <span class="notification-title">${n.title}</span>
                        <span class="notification-time">${n.time.toLocaleTimeString()}</span>
                    </div>
                    <p class="notification-message">${n.message}</p>
                </div>
            `).join('')
            : '<p class="text-center text-gray-500 p-4">No notifications</p>';
    } else {
        console.error('[updateNotifications] notificationsList element not found');
    }
};

const sendNotificationToStudent = async (studentId, title, message) => {
    try {
        const notificationsRef = ref(db, `studentNotifications/${studentId}`);
        await set(push(notificationsRef), {
            title,
            message,
            timestamp: new Date().toISOString(),
            read: false
        });
        console.log(`[sendNotificationToStudent] Sent to ${studentId}:`, { title, message });
    } catch (error) {
        logError('Failed to send student notification', error);
    }
};

const listenForAdminNotifications = () => {
    const notificationsRef = ref(db, 'adminNotifications');
    onValue(notificationsRef, (snapshot) => {
        const data = snapshot.val();
        if (data) {
            const newNotifications = Object.entries(data).map(([id, value]) => ({ id, ...value }));
            newNotifications.forEach(async (notification) => {
                if (!notifications.some(n => n.id === notification.id)) {
                    let message = notification.message || 'New request received';
                    try {
                        const userData = await fetchUserData(notification.studentId);
                        const studentEmail = userData.email || notification.studentId;
                        console.log(`[listenForAdminNotifications] Fetched student email for studentId ${notification.studentId}: ${studentEmail}`);
                        if (!message.includes(studentEmail)) {
                            message = `${studentEmail} has requested ${notification.title}`;
                        }
                    } catch (error) {
                        console.error(`[listenForAdminNotifications] Failed to fetch user data for studentId ${notification.studentId}:`, error);
                    }
                    addNotification('New Request', message);
                }
            });
        }
    });
};

const setupEventListeners = () => {
    if (searchInput) {
        searchInput.addEventListener('input', (e) => renderTable(e.target.value));
    } else {
        console.error('[setupEventListeners] searchInput element not found');
    }

    tabButtons.forEach(button => {
        button.addEventListener('click', () => {
            tabButtons.forEach(btn => {
                btn.classList.remove('active', 'text-blue-600', 'border-blue-600');
                btn.classList.add('text-gray-600');
            });
            button.classList.add('active', 'text-blue-600', 'border-blue-600');
            renderTable();
        });
    });

    if (addResourceBtn) {
        addResourceBtn.addEventListener('click', () => {
            isEditing = false;
            editingResourceId = null;
            if (document.getElementById('modalTitle')) {
                document.getElementById('modalTitle').textContent = 'Add New Resource';
            }
            if (resourceForm) resourceForm.reset();
            if (document.getElementById('type')) {
                const typeValue = document.getElementById('type').value;
                if (document.getElementById('fileUploadGroup')) {
                    document.getElementById('fileUploadGroup').classList.toggle('hidden', typeValue !== 'pdf');
                }
                if (document.getElementById('resourceLinkGroup')) {
                    document.getElementById('resourceLinkGroup').classList.toggle('hidden', typeValue === 'pdf');
                }
            }
            if (resourceModal) resourceModal.classList.remove('hidden');
        });
    } else {
        console.error('[setupEventListeners] addResourceBtn element not found');
    }

    if (resourceModal) {
        resourceModal.querySelector('.close-button')?.addEventListener('click', () => {
            resourceModal.classList.add('hidden');
        });
        resourceModal.querySelector('[data-action="cancel"]')?.addEventListener('click', () => {
            resourceModal.classList.add('hidden');
        });
    }

    if (document.getElementById('type')) {
        document.getElementById('type').addEventListener('change', (e) => {
            if (document.getElementById('fileUploadGroup')) {
                document.getElementById('fileUploadGroup').classList.toggle('hidden', e.target.value !== 'pdf');
            }
            if (document.getElementById('resourceLinkGroup')) {
                document.getElementById('resourceLinkGroup').classList.toggle('hidden', e.target.value === 'pdf');
            }
        });
    }

    if (resourceForm) {
        resourceForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            const formData = new FormData(resourceForm);
            const resourceData = {
                title: formData.get('title'),
                type: formData.get('type'),
                description: formData.get('description'),
                status: 'available',
                createdAt: new Date().toISOString()
            };

            try {
                if (resourceData.type === 'pdf') {
                    const file = formData.get('fileUpload');
                    if (file && file.size > 0) {
                        const fileRef = storageRef(storage, `resources/${file.name}`);
                        await uploadBytes(fileRef, file);
                        resourceData.fileUrl = await getDownloadURL(fileRef);
                    } else {
                        throw new Error('No file selected for PDF resource.');
                    }
                } else {
                    const link = formData.get('resourceLink');
                    if (link) {
                        resourceData.resourceLink = link;
                    } else {
                        throw new Error('No link provided for course/training resource.');
                    }
                }
                const resourceRef = isEditing ? ref(db, `resources/${editingResourceId}`) : push(ref(db, 'resources'));
                await set(resourceRef, resourceData);
                addNotification('Resource Saved', `${resourceData.title} has been ${isEditing ? 'updated' : 'added'}.`);
                if (resourceModal) resourceModal.classList.add('hidden');
                updateStatsAndCharts();
            } catch (error) {
                logError('Failed to save resource', error);
                addNotification('Error', 'Failed to save resource: ' + error.message);
            }
        });
    }

    if (resourceTableBody) {
        resourceTableBody.addEventListener('click', async (e) => {
            const row = e.target.closest('tr');
            if (!row) return;
            const id = row.dataset.id;
            const activeTab = document.querySelector('.tab-button.active')?.dataset.tab;
            if (!activeTab) return;

            try {
                if (e.target.classList.contains('edit')) {
                    const path = activeTab === 'all' ? 'resources' : 'requests';
                    fetchDataRealTime(path, async (data) => {
                        const item = data.find(i => i.id === id);
                        if (!item) return;
                        isEditing = true;
                        editingResourceId = id;
                        if (document.getElementById('modalTitle')) {
                            document.getElementById('modalTitle').textContent = activeTab === 'all' ? 'Edit Resource' : 'Edit Request';
                        }
                        if (document.getElementById('title')) document.getElementById('title').value = item.title || '';
                        if (document.getElementById('type')) document.getElementById('type').value = item.type || '';
                        if (document.getElementById('description')) document.getElementById('description').value = item.description || '';
                        if (document.getElementById('fileUploadGroup')) {
                            document.getElementById('fileUploadGroup').style.display = item.type === 'pdf' ? 'block' : 'none';
                        }
                        if (resourceModal) resourceModal.classList.remove('hidden');
                    });
                } else if (e.target.classList.contains('delete')) {
                    if (confirm('Are you sure you want to delete this item?')) {
                        const path = activeTab === 'all' ? `resources/${id}` : `requests/${id}`;
                        await set(ref(db, path), null);
                        addNotification('Item Deleted', 'Item removed successfully.');
                        if (activeTab !== 'all') row.remove();
                        updateStatsAndCharts();
                    }
                } else if (e.target.classList.contains('approve')) {
                    console.log(`[Approve] Starting approval for request ${id}`);
                    const requests = await fetchDataOnce('requests');
                    const request = requests.find(r => r.id === id);
                    if (!request) {
                        console.log(`[Approve] Request ${id} not found`);
                        return;
                    }
                    if (request.status !== 'pending') {
                        console.log(`[Approve] Request ${id} is not pending, status: ${request.status}`);
                        return;
                    }
                    const updatedRequest = { 
                        ...request, 
                        status: 'approved', 
                        approvedAt: new Date().toISOString() 
                    };
                    await set(ref(db, `requests/${id}`), updatedRequest);
                    console.log(`[Approve] Updated request ${id} to approved in Firebase`);
                    addNotification('Request Approved', `${request.title || 'Untitled'} approved.`);
                    await sendNotificationToStudent(request.studentId || 'unknown', 'Request Approved', `${request.title || 'Untitled'} has been approved.`);
                    if (activeTab === 'pending') {
                        console.log(`[Approve] Removing row ${id} from UI`);
                        row.remove();
                    }
                    updateStatsAndCharts();
                    console.log(`[Approve] Completed approval for request ${id}`);
                } else if (e.target.classList.contains('reject')) {
                    console.log(`[Reject] Starting rejection for request ${id}`);
                    const requests = await fetchDataOnce('requests');
                    const request = requests.find(r => r.id === id);
                    if (!request) {
                        console.log(`[Reject] Request ${id} not found`);
                        return;
                    }
                    if (request.status !== 'pending') {
                        console.log(`[Reject] Request ${id} is not pending, status: ${request.status}`);
                        return;
                    }
                    const updatedRequest = { 
                        ...request, 
                        status: 'rejected', 
                        rejectedAt: new Date().toISOString() 
                    };
                    await set(ref(db, `requests/${id}`), updatedRequest);
                    console.log(`[Reject] Updated request ${id} to rejected in Firebase`);
                    addNotification('Request Rejected', `${request.title || 'Untitled'} rejected.`);
                    await sendNotificationToStudent(request.studentId || 'unknown', 'Request Rejected', `${request.title || 'Untitled'} has been rejected.`);
                    if (activeTab === 'pending') {
                        console.log(`[Reject] Removing row ${id} from UI`);
                        row.remove();
                    }
                    updateStatsAndCharts();
                    console.log(`[Reject] Completed rejection for request ${id}`);
                }
            } catch (error) {
                logError('Action failed', error);
            }
        });
    }

    if (notificationButton) {
        notificationButton.addEventListener('click', () => {
            if (notificationsPanel) {
                notificationsPanel.classList.toggle('hidden');
                notifications.forEach(n => n.read = true);
                updateNotifications();
            }
        });
    }

    if (document.querySelector('.clear-all-button')) {
        document.querySelector('.clear-all-button').addEventListener('click', () => {
            notifications = [];
            updateNotifications();
        });
    }

    document.addEventListener('click', (e) => {
        if (notificationsPanel && notificationButton) {
            if (!notificationsPanel.contains(e.target) && !notificationButton.contains(e.target)) {
                notificationsPanel.classList.add('hidden');
            }
        }
    });
};

const initDashboard = () => {
    console.log('[initDashboard] Initializing dashboard');
    renderTable();
    updateStatsAndCharts();
    listenForAdminNotifications();
    setupEventListeners();
};

document.addEventListener('DOMContentLoaded', () => {
    console.log('[DOMContentLoaded] DOM fully loaded');
    onAuthStateChanged(auth, (user) => {
        if (user) {
            console.log('[Auth] Admin user authenticated:', user.email);
            initDashboard();
        } else {
            console.log('[Auth] No user authenticated, redirecting to login');
            window.location.href = 'login.html';
        }
    });

    const logoutBtn = document.querySelector('a[onclick="handleLogout()"]');
    if (logoutBtn) {
        logoutBtn.addEventListener('click', async (e) => {
            e.preventDefault();
            if (confirm('Do you want to logout?')) {
                try {
                    await auth.signOut();
                    window.location.href = 'login.html';
                } catch (error) {
                    logError('Logout failed', error);
                }
            }
        });
    } else {
        console.error('[DOMContentLoaded] Logout button not found');
    }
});