async function loadNotifications() {
	if (!requireAuthentication()) return;
	const payload = await apiRequest('/notifications/pending');
	const list = document.querySelector('[data-notifications]');
	list.innerHTML = payload.notifications.map(notification => `<article class="panel"><h2>${notification.title || notification.type}</h2><p>${notification.testName || ''}</p><p>${notification.testDate || ''} ${notification.testTime || ''}</p><button class="btn btn-small" onclick="markNotificationRead('${notification.id}')">Mark as read</button></article>`).join('') || '<p>No pending notifications.</p>';
}

async function markNotificationRead(id) {
	await apiRequest(`/notifications/${encodeURIComponent(id)}/read`, { method: 'PATCH' });
	loadNotifications();
}
