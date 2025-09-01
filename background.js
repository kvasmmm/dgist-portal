// Listen for messages from content script
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.type === 'showNotification') {
        // Create and show the notification
        chrome.notifications.create({
            type: 'basic',
            iconUrl: 'svag.svg',
            title: message.title,
            message: message.message,
            priority: 2
        });
    }
});
