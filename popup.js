document.addEventListener('DOMContentLoaded', function() {
    const form = document.getElementById('loginForm');
    const status = document.getElementById('status');
    
    // Load saved credentials when popup opens
    chrome.storage.local.get(['dgistUser', 'dgistPass'], function(data) {
        if (data.dgistUser) document.getElementById('username').value = data.dgistUser;
        if (data.dgistPass) document.getElementById('password').value = data.dgistPass;
    });

    // Handle form submission
    form.onsubmit = function(e) {
        e.preventDefault();
        
        const username = document.getElementById('username').value.trim();
        const password = document.getElementById('password').value;
        
        if (!username || !password) {
            status.textContent = "Please enter both username and password";
            status.className = "error";
            return;
        }

        // Save credentials
        chrome.storage.local.set(
            { 
                dgistUser: username, 
                dgistPass: password 
            }, 
            function() {
                status.textContent = "Credentials saved successfully!";
                status.className = "";
                
                // Animate the status message
                status.style.opacity = "0";
                status.style.transform = "translateY(10px)";
                setTimeout(() => {
                    status.style.transition = "all 0.3s ease";
                    status.style.opacity = "1";
                    status.style.transform = "translateY(0)";
                }, 50);
            }
        );
    };
});