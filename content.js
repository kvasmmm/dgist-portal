// DGIST Portal Automation — content script
// - Handles: login form filling (isign/auth), 2FA code retrieval from Gmail, and 2FA submission flow
// - Key behavior: request new code, wait for newest email code, fill, submit, confirm alert, submit again

// ---- Configuration ----
// Define login form configurations for different portals
const PORTAL_CONFIGS = {
    isign: {
        urls: ['isign.dgist.ac.kr/authentication'],
        selectors: {
            username: '#id',
            password: '#pw',
            button: '#btn-login'
        }
    },
    auth: {
        urls: ['auth.dgist.ac.kr/login'],
        selectors: {
            username: '#loginID',
            password: '#password',
            button: '#loginForm > div.mb-10.default.ui.tab.active > button',
            remember: '#rememberLoginID'
        }
    },
    twoFactor: {
        urls: ['auth.dgist.ac.kr/login/authentication/two-factor/verification'],
        selectors: {
            alertButton: '#alert_btn',
            codeInput: '#code',
            submitButton: 'body > div.body > div.wrap.container > div.contents > div.field > div.input.light > button'
        }
    }
};

// ---- Utility & Portal Detection ----
// Pick the most specific portal config that matches the current URL (longest match wins)
function getCurrentPortal() {
    const currentUrl = window.location.href;
    let best = null;
    let bestLen = -1;
    for (const [portal, config] of Object.entries(PORTAL_CONFIGS)) {
        for (const url of config.urls) {
            if (currentUrl.includes(url) && url.length > bestLen) {
                best = { portal, config };
                bestLen = url.length;
            }
        }
    }
    return best;
}

// Show a user notification (delegated to background)
function showNotification(title, message) {
    chrome.runtime.sendMessage({
        type: 'showNotification',
        title: title,
        message: message
    });
}

// Quick readiness check for required elements on the current page
function checkElements() {
    const portalInfo = getCurrentPortal();
    if (!portalInfo) return false;

    const { selectors } = portalInfo.config;
    
    // Handle two-factor authentication page differently
    if (portalInfo.portal === 'twoFactor') {
        const alertBtn = document.querySelector(selectors.alertButton);
        const codeInput = document.querySelector(selectors.codeInput);
        const submitButton = document.querySelector(selectors.submitButton);
        return alertBtn || (codeInput && submitButton);
    }

    // Handle regular login pages
    const userInput = document.querySelector(selectors.username);
    const passInput = document.querySelector(selectors.password);
    const loginBtn = document.querySelector(selectors.button);
    return userInput && passInput && loginBtn;
}

// ---- Two-Factor Authentication (2FA) ----
// Timings
const POLL_INTERVAL_MS = 1000;          // Gmail polling cadence (faster)
const POLL_MAX_ATTEMPTS = 90;           // ~90s total
const CONFIRM_ALERT_POLL_MS = 50;       // Confirm alert ASAP
const CONFIRM_ALERT_MAX_MS = 5000;      // Up to 5s for confirm alert

// Handle the entire 2FA interaction lifecycle on the verification page
async function handleTwoFactor() {
    console.log('Handling two-factor authentication...');
    const portalInfo = getCurrentPortal();
    if (!portalInfo || portalInfo.portal !== 'twoFactor') return false;

    const { selectors } = portalInfo.config;
    const alertBtn = document.querySelector(selectors.alertButton);
    const codeInput = document.querySelector(selectors.codeInput);
    const submitButton = document.querySelector(selectors.submitButton);

    if (!codeInput || !submitButton) {
        console.log('2FA input or submit button not found yet');
        return false;
    }

    // Click the alert (request) button once to trigger sending the code and mark baseline time
    if (alertBtn && !window.__dgistRequestAlertClicked) {
        console.log('Clicking alert button to request code...');
        window.__dgistRequestAlertClicked = true;
        window.__dgistCodeBaseline = Date.now();
        alertBtn.click();
    }

    // Start polling Gmail for the newest code if not already started
    if (!window.__dgistTwoFactorPolling) {
        window.__dgistTwoFactorPolling = true;

        // Store the code we've already tried to avoid reusing an old one
    let lastTriedCode = null;
    let attempts = 0;
    const maxAttempts = POLL_MAX_ATTEMPTS;

        const poll = async () => {
            attempts++;
            console.log(`[2FA] Poll attempt ${attempts}/${maxAttempts}`);

            try {
                // Only accept codes newer than when we requested one
                const baseline = window.__dgistCodeBaseline || (window.__dgistRequestAlertClicked ? Date.now() : 0);
                const result = await fetchLatestGmailCode(baseline);
                if (result && result.code && result.code !== lastTriedCode) {
                    console.log('[2FA] New code obtained from Gmail:', result.code, 'at', new Date(result.internalDate).toLocaleTimeString());
                    // Fill input
                    codeInput.focus();
                    codeInput.value = result.code;
                    codeInput.dispatchEvent(new Event('input', { bubbles: true }));
                    codeInput.dispatchEvent(new Event('change', { bubbles: true }));

                    // Small delay then submit first, then click confirm alert as soon as it appears, then submit again
                    setTimeout(() => {
                        if (submitButton) {
                            console.log('[2FA] Clicking submit button after code fill');
                            submitButton.click();
                        }

                        // Fast poll for a confirmation alert button to appear and click it ASAP
                        const start = Date.now();
                        const maxWaitMs = CONFIRM_ALERT_MAX_MS; // wait up to 5s for confirm alert
                        const pollMs = CONFIRM_ALERT_POLL_MS;
                        const pollId = setInterval(() => {
                            const confirmBtn = document.querySelector(selectors.alertButton);
                            if (confirmBtn && isClickable(confirmBtn) && !window.__dgistConfirmAlertClicked) {
                                window.__dgistConfirmAlertClicked = true;
                                console.log('[2FA] Clicking #alert_btn confirm after submit');
                                confirmBtn.click();
                                setTimeout(() => {
                                    if (submitButton) {
                                        console.log('[2FA] Clicking submit button again after alert confirm');
                                        submitButton.click();
                                    }
                                }, 100);
                                clearInterval(pollId);
                            }
                            if (Date.now() - start > maxWaitMs) {
                                clearInterval(pollId);
                            }
                        }, pollMs);
                    }, 200);

                    if (intervalId) clearInterval(intervalId);
                    window.__dgistTwoFactorPolling = false;
                    return;
                }
            } catch (e) {
                console.warn('[2FA] Error while polling Gmail:', e);
            }

            if (attempts >= maxAttempts) {
                console.log('[2FA] Gave up waiting for new code.');
                showNotification('DGIST 2FA', 'Waited for a code but none arrived. You can request a new code and try again.');
                clearInterval(intervalId);
                window.__dgistTwoFactorPolling = false;
            }
        };

        // Begin polling with a short initial delay to let code be sent
        let intervalId = null;
    setTimeout(() => {
            // First quick check
            poll();
            // Then regular interval
            intervalId = setInterval(poll, POLL_INTERVAL_MS);
    }, 1000);
    }
    
    return true;
}

// ---- Gmail Helpers ----
// Validate stored token freshness
function isTokenValid(tokenData) {
    if (!tokenData || !tokenData.access_token || !tokenData.expires_in || !tokenData.timestamp) return false;
    const expirationTime = tokenData.timestamp + (tokenData.expires_in * 1000);
    return Date.now() < expirationTime - 5000; // 5s skew
}

// Fetch the newest 6-digit code (newer than baselineMs) from Gmail using stored OAuth token
async function fetchLatestGmailCode(baselineMs) {
    const tokenData = await new Promise(resolve => {
        chrome.storage.local.get(['gmail_token'], (data) => resolve(data.gmail_token));
    });

    if (!isTokenValid(tokenData)) {
        console.log('[2FA] No valid Gmail token. Please connect Gmail in the extension popup.');
        return null;
    }

    const accessToken = tokenData.access_token;

    // Get recent messages from DGIST sender; tighten query to recent to avoid old codes
    const listUrl = 'https://gmail.googleapis.com/gmail/v1/users/me/messages?q=' + encodeURIComponent('from:no-reply@dgist.ac.kr newer_than:1h') + '&maxResults=5';

    const listResp = await fetch(listUrl, {
        headers: { 'Authorization': `Bearer ${accessToken}` }
    });

    if (!listResp.ok) {
        console.warn('[2FA] Failed to list Gmail messages:', listResp.status, listResp.statusText);
        return null;
    }

    const listJson = await listResp.json();
    const messages = listJson.messages || [];
    if (!messages.length) return null;

    // Iterate newest first, track the latest valid code newer than baseline
    let best = null; // { code, internalDate }
    for (const m of messages) {
        try {
            const detailResp = await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/messages/${m.id}`, {
                headers: { 'Authorization': `Bearer ${accessToken}` }
            });
            if (!detailResp.ok) continue;
            const msg = await detailResp.json();

            // Prefer text/plain parts; fallback to body
            let bodyData = '';
            const payload = msg.payload || {};
            if (payload.parts && Array.isArray(payload.parts)) {
                const textPart = payload.parts.find(p => (p.mimeType || '').includes('text/plain')) || payload.parts[0];
                bodyData = textPart?.body?.data || '';
            } else if (payload.body && payload.body.data) {
                bodyData = payload.body.data;
            }

            if (!bodyData) continue;
            const decoded = atob(bodyData.replace(/-/g, '+').replace(/_/g, '/'));
            const match = decoded.match(/\b\d{6}\b/);
            if (match) {
                const code = match[0];
                const ts = Number(msg.internalDate || 0);
                // Accept only codes newer than the moment we requested a new code (allow 2s skew)
                const baseline = Number(baselineMs || 0) - 2000;
                if (!baseline || ts >= baseline) {
                    if (!best || ts > best.internalDate) {
                        best = { code, internalDate: ts };
                    }
                }
            }
        } catch (e) {
            console.warn('[2FA] Failed to parse a Gmail message:', e);
        }
    }

    if (best) {
        chrome.storage.local.set({ latest_verification_code: best.code });
    }
    return best;
}

// ---- Login Form & Errors ----
// Parse and surface login error messages (alertify)
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

// Check the page for a login error banner
function checkLoginError() {
    const errorDiv = document.querySelector('div.alertify div.ajs-content');
    if (errorDiv && errorDiv.textContent.trim()) {
        const errorMessage = errorDiv.textContent.trim();
        handleLoginError(errorMessage);
        return true;
    }
    return false;
}

// Fill in login form (isign/auth) and submit. If 2FA page detected mid-way, switch to 2FA.
function fillLoginForm() {
    const portalInfo = getCurrentPortal();
    if (!portalInfo) return;

    // Handle two-factor authentication page
    if (portalInfo.portal === 'twoFactor') {
        handleTwoFactor();
        return;
    }

    console.log('Checking for saved credentials...');
    
    chrome.storage.local.get(['dgistUser', 'dgistPass'], function(data) {
        if (data.dgistUser && data.dgistPass) {
            console.log('Credentials found, attempting to fill form...');
            
            // Try to fill the form multiple times in case of dynamic loading
            let attempts = 0;
            const maxAttempts = 10;
            
            function tryFillForm() {
                const portalInfo = getCurrentPortal();
                if (!portalInfo) {
                    console.log('Not on a recognized login page');
                    return;
                }

                // If we navigated to 2FA during retries, switch behavior immediately
                if (portalInfo.portal === 'twoFactor') {
                    console.log('Detected 2FA page during login retries; switching to 2FA handler.');
                    handleTwoFactor();
                    return;
                }

                // Get form elements using the correct selectors for the current portal
                const { selectors } = portalInfo.config;
                const userInput = document.querySelector(selectors.username);
                const passInput = document.querySelector(selectors.password);
                const loginBtn = document.querySelector(selectors.button);
                const rememberCb = selectors.remember ? document.querySelector(selectors.remember) : null;

                if (checkElements()) {
                    console.log('Form elements found, filling credentials...');
                    
                    // Fill in the credentials (with events)
                    setInputValue(userInput, data.dgistUser);
                    setInputValue(passInput, data.dgistPass);
                    
                    // Ensure "Remember ID" is checked on auth login page
                    if (rememberCb && !rememberCb.checked) {
                        try {
                            rememberCb.click();
                        } catch {
                            rememberCb.checked = true;
                            rememberCb.dispatchEvent(new Event('change', { bubbles: true }));
                        }
                    }

                    // Small delay before clicking the login button
                    setTimeout(() => {
                        console.log('Clicking login button...');
                        try {
                            // Ensure visibility
                            loginBtn.scrollIntoView({ block: 'center', behavior: 'instant' });
                        } catch {}

                        // Primary: click the button if clickable
                        if (isClickable(loginBtn)) {
                            try { loginBtn.click(); } catch (e) { console.warn('Login button click failed:', e); }
                        } else {
                            console.log('Login button not clickable; attempting form submit');
                        }

                        // Fallbacks: submit the form directly
                        const formEl = loginBtn.closest('form') || document.querySelector('#loginForm');
                        if (formEl) {
                            try {
                                if (typeof formEl.requestSubmit === 'function') {
                                    formEl.requestSubmit(loginBtn);
                                } else if (typeof formEl.submit === 'function') {
                                    formEl.submit();
                                }
                            } catch (e) {
                                console.warn('Form submit failed, trying Enter key:', e);
                                // Last resort: simulate Enter on password field
                                const evt = new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', which: 13, keyCode: 13, bubbles: true });
                                passInput.dispatchEvent(evt);
                            }
                        }
                        
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

// ---- Bootstrap ----
// Determine if any of our portal configs match
function isLoginPage() {
    return getCurrentPortal() !== null;
}

// Helper: element is visible and enabled (click-safe)
function isClickable(el) {
    if (!el) return false;
    const rect = el.getBoundingClientRect();
    const visible = rect.width > 0 && rect.height > 0;
    const style = window.getComputedStyle(el);
    const notHidden = style.visibility !== 'hidden' && style.display !== 'none' && style.pointerEvents !== 'none';
    return visible && notHidden && !el.disabled;
}

// Helper: set input value and fire input/change events so frameworks react
function setInputValue(el, value) {
    if (!el) return;
    try {
        const proto = Object.getPrototypeOf(el);
        const desc = Object.getOwnPropertyDescriptor(proto, 'value');
        if (desc && typeof desc.set === 'function') {
            desc.set.call(el, value);
        } else {
            el.value = value;
        }
    } catch {
        el.value = value;
    }
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
}

// Initial check and setup
if (isLoginPage()) {
    console.log('On DGIST login page, URL:', window.location.href);
    
    // Wait for the page to be loaded
    const start = () => {
        const info = getCurrentPortal();
        if (info && info.portal === 'twoFactor') {
            handleTwoFactor();
        } else {
            fillLoginForm();
        }
    };

    if (document.readyState === 'complete') {
        start();
    } else {
        window.addEventListener('load', start);
    }
    
    // Observe DOM changes for both form elements and error messages
    const observer = new MutationObserver((mutations, obs) => {
        if (checkLoginError()) {
            obs.disconnect();
            return;
        }
        
        if (checkElements()) {
            const info = getCurrentPortal();
            if (info && info.portal === 'twoFactor') {
                handleTwoFactor();
            } else {
                console.log('Login form detected through DOM changes');
                fillLoginForm();
            }
        }
    });

    observer.observe(document.body, {
        childList: true,
        subtree: true,
        characterData: true
    });
}