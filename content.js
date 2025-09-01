// Function to show notification using chrome.notifications
function showNotification(title, message) {
    chrome.runtime.sendMessage({
        type: 'showNotification',
        title: title,
        message: message
    });
}

// Function to check if elements are ready
function checkElements() {
    const userInput = document.querySelector('#id');
    const passInput = document.querySelector('#pw');
    const loginBtn = document.querySelector('#btn-login');
    return userInput && passInput && loginBtn;
}

// Function to handle login error
function handleLoginError(errorMessage) {
    console.log('Login failed:', errorMessage);
    
    let title = 'DGIST Portal Login Failed';
    let message = errorMessage;
    let shouldClearCredentials = false;

    // Specific error handling
    if (errorMessage.includes('ID or password is incorrect')) {
        message = 'Incorrect ID or password. Please click the extension icon to update your credentials.';
        shouldClearCredentials = true;
    } else if (errorMessage.includes('limited to log in for')) {
        title = 'DGIST Portal Login Limited';
        message = 'Login is temporarily limited. ' + errorMessage + ' Please try again later.';
    }
    
    // Show notification to user
    showNotification(title, message);
    
    // Clear the stored credentials if needed
    if (shouldClearCredentials) {
        chrome.storage.local.remove(['dgistUser', 'dgistPass'], function() {
            console.log('Cleared incorrect credentials');
        });
    }
}

// Function to check for login error message
function checkLoginError() {
    const errorDiv = document.querySelector('div.alertify div.ajs-content');
    if (errorDiv && errorDiv.textContent.trim()) {
        const errorMessage = errorDiv.textContent.trim();
        handleLoginError(errorMessage);
        return true;
    }
    return false;
}

// Function to fill in the login form
function fillLoginForm() {
    console.log('Checking for saved credentials...');
    
    chrome.storage.local.get(['dgistUser', 'dgistPass'], function(data) {
        if (data.dgistUser && data.dgistPass) {
            console.log('Credentials found, attempting to fill form...');
            
            // Try to fill the form multiple times in case of dynamic loading
            let attempts = 0;
            const maxAttempts = 10;
            
            function tryFillForm() {
                // Get form elements
                const userInput = document.querySelector('#id');
                const passInput = document.querySelector('#pw');
                const loginBtn = document.querySelector('#btn-login');

                if (checkElements()) {
                    console.log('Form elements found, filling credentials...');
                    
                    // Fill in the credentials
                    userInput.value = data.dgistUser;
                    passInput.value = data.dgistPass;
                    
                    // Trigger input events to ensure form validation works
                    const inputEvent = new Event('input', { bubbles: true });
                    const changeEvent = new Event('change', { bubbles: true });
                    
                    userInput.dispatchEvent(inputEvent);
                    userInput.dispatchEvent(changeEvent);
                    passInput.dispatchEvent(inputEvent);
                    passInput.dispatchEvent(changeEvent);
                    
                    // Small delay before clicking the login button
                    setTimeout(() => {
                        console.log('Clicking login button...');
                        loginBtn.click();
                        
                        // Start monitoring for login error
                        let errorCheckAttempts = 0;
                        const checkError = setInterval(() => {
                            if (checkLoginError() || errorCheckAttempts > 10) {
                                clearInterval(checkError);
                            }
                            errorCheckAttempts++;
                        }, 500);
                    }, 500);
                } else {
                    attempts++;
                    if (attempts < maxAttempts) {
                        console.log(`Form elements not found yet. Attempt ${attempts}/${maxAttempts}`);
                        setTimeout(tryFillForm, 500);
                    } else {
                        console.log('Failed to find form elements after maximum attempts');
                        showNotification(
                            'DGIST Portal Login Error',
                            'Could not find login form elements. Please try refreshing the page.'
                        );
                    }
                }
            }
            
            // Start trying to fill the form
            tryFillForm();
        } else {
            console.log('No saved credentials found');
            showNotification(
                'DGIST Portal Login',
                'Please click the extension icon to enter your credentials.'
            );
        }
    });
}

// Function to check if we're on a login page
function isLoginPage() {
    return window.location.href.includes('isign.dgist.ac.kr/authentication');
}

// Initial check and setup
if (isLoginPage()) {
    console.log('On DGIST login page, URL:', window.location.href);
    
    // Wait for the page to be loaded
    if (document.readyState === 'complete') {
        fillLoginForm();
    } else {
        window.addEventListener('load', fillLoginForm);
    }
    
    // Observe DOM changes for both form elements and error messages
    const observer = new MutationObserver((mutations, obs) => {
        if (checkLoginError()) {
            obs.disconnect();
            return;
        }
        
        if (checkElements()) {
            console.log('Login form detected through DOM changes');
            fillLoginForm();
        }
    });

    observer.observe(document.body, {
        childList: true,
        subtree: true,
        characterData: true,
        subtree: true
    });
}