console.log('popup.js file loaded - WITH GMAIL INTEGRATION');

// Gmail API configuration
const CLIENT_ID = "512491148969-mkej3cctpprn0d4gabvc3tv48iaba9ae.apps.googleusercontent.com";
const SCOPES = ["https://www.googleapis.com/auth/gmail.readonly"];

// Simple initialization
document.addEventListener('DOMContentLoaded', function() {
    console.log('DOM Content Loaded - WITH GMAIL');
    
    // Initialize basic login form first
    initializeLoginForm();
    
    // Initialize Gmail integration
    initializeGmailWithIdentityAPI();
});

async function initializeGmailWithIdentityAPI() {
    console.log('Initializing Gmail with Chrome Identity API');
    
    const connectBtn = document.getElementById('connectBtn');
    
    if (connectBtn) {
        connectBtn.textContent = 'Connect Gmail';
        connectBtn.onclick = async function() {
            console.log('Connect Gmail button clicked');
            try {
                await connectToGmail();
            } catch (error) {
                console.error('Error connecting to Gmail:', error);
                alert('Failed to connect to Gmail: ' + error.message);
            }
        };
    }
    
    // Check if we already have a token
    try {
        const token = await getStoredToken();
        if (token && isTokenValid(token)) {
            console.log('Found valid stored token');
            connectBtn.textContent = 'Connected';
            connectBtn.disabled = true;
            // Optionally prefetch to cache latest code; UI list removed
            await fetchGmailMessages(token.access_token);
        }
    } catch (error) {
        console.log('No valid stored token found');
    }
}

async function connectToGmail() {
    console.log('Starting OAuth via chrome.identity.launchWebAuthFlow');

    const connectBtn = document.getElementById('connectBtn');
    if (connectBtn) {
        connectBtn.textContent = 'Opening Google authorization...';
        connectBtn.disabled = true;
    }

    try {
        // Build OAuth2 URL (implicit flow)
    // Use base redirect URL to match what you register in Google Cloud
    const redirectUri = chrome.identity.getRedirectURL();
        const authParams = new URLSearchParams({
            client_id: CLIENT_ID,
            response_type: 'token',
            redirect_uri: redirectUri,
            scope: SCOPES.join(' '),
            include_granted_scopes: 'true',
            prompt: 'consent'
        });

        const authUrl = `https://accounts.google.com/o/oauth2/v2/auth?${authParams.toString()}`;
        console.log('Auth URL:', authUrl, 'Redirect:', redirectUri);

    // Inform the user the separate auth window might look blank on return
    const statusEl = document.getElementById('status');
    if (statusEl) statusEl.textContent = 'Authorizing with Google…';

    chrome.identity.launchWebAuthFlow({ url: authUrl, interactive: true }, async (redirectedTo) => {
            if (chrome.runtime.lastError) {
                console.error('Auth flow error:', chrome.runtime.lastError);
                alert('Failed to authorize: ' + chrome.runtime.lastError.message);
                if (connectBtn) {
                    connectBtn.textContent = 'Connect Gmail';
                    connectBtn.disabled = false;
                }
                return;
            }

            try {
                // Parse access_token from the fragment of the redirect URL
                const { access_token, expires_in, scope, token_type } = parseFragment(redirectedTo);
                if (!access_token) {
                    throw new Error('No access token received');
                }

                const tokenData = {
                    access_token,
                    expires_in: Number(expires_in || 3600),
                    scope,
                    token_type: token_type || 'Bearer',
                    timestamp: Date.now()
                };

                await storeToken(tokenData);
                console.log('Token stored, fetching messages...');
        if (statusEl) statusEl.textContent = 'Authorized. Fetching verification codes…';

                await fetchGmailMessages(access_token);

                if (connectBtn) {
                    connectBtn.textContent = 'Connected';
                    connectBtn.disabled = true;
                }
        if (statusEl) statusEl.textContent = 'Ready. Codes loaded.';
            } catch (e) {
                console.error('Error processing auth result:', e);
                alert('Authorization succeeded but failed to process token: ' + e.message);
                if (connectBtn) {
                    connectBtn.textContent = 'Connect Gmail';
                    connectBtn.disabled = false;
                }
        if (statusEl) statusEl.textContent = 'Authorization failed to complete.';
            }
        });
    } catch (error) {
        console.error('Error in connectToGmail:', error);
        alert('Failed to connect to Gmail: ' + error.message);
        if (connectBtn) {
            connectBtn.textContent = 'Connect Gmail';
            connectBtn.disabled = false;
        }
    }
}

function parseFragment(url) {
    try {
        const u = new URL(url);
        const hash = u.hash.startsWith('#') ? u.hash.slice(1) : u.hash;
        const params = new URLSearchParams(hash);
        const result = {};
        for (const [k, v] of params.entries()) {
            result[k] = v;
        }
        return result;
    } catch {
        return {};
    }
}

async function handleAuthSuccess(tabId, token, connectBtn) {
    console.log('Authentication successful, fetching Gmail data...');
    
    try {
        // Store the token
        const tokenData = {
            access_token: token.access_token,
            expires_in: 3600,
            timestamp: Date.now()
        };
        
        await new Promise(resolve => {
            chrome.storage.local.set({ gmail_token: tokenData }, resolve);
        });
        
        // Fetch verification codes using the authenticated GAPI client in the test.html tab
        chrome.scripting.executeScript({
            target: { tabId: tabId },
            func: async () => {
                try {
                    const response = await gapi.client.gmail.users.messages.list({
                        userId: "me",
                        q: "from:no-reply@dgist.ac.kr",
                        maxResults: 10
                    });

                    const messages = response.result.messages || [];
                    const codes = [];

                    for (let msg of messages.slice(0, 6)) {
                        const msgDetail = await gapi.client.gmail.users.messages.get({
                            userId: "me",
                            id: msg.id
                        });

                        let bodyData = "";
                        if (msgDetail.result.payload.parts) {
                            bodyData = msgDetail.result.payload.parts[0].body.data;
                        } else if (msgDetail.result.payload.body.data) {
                            bodyData = msgDetail.result.payload.body.data;
                        }

                        if (bodyData) {
                            const decoded = atob(bodyData.replace(/-/g, "+").replace(/_/g, "/"));
                            const match = decoded.match(/\\b\\d{6}\\b/);
                            if (match) {
                                const code = match[0];
                                const date = new Date(parseInt(msgDetail.result.internalDate));
                                codes.push({
                                    code: code,
                                    date: date.toLocaleString()
                                });
                            }
                        }
                    }
                    
                    return codes;
                } catch (error) {
                    console.error('Error fetching codes:', error);
                    return [];
                }
            }
        }, (results) => {
            if (results && results[0] && results[0].result) {
                const codes = results[0].result;
                
                // Store verification codes
                const storageData = { verification_codes: codes };
                if (codes.length > 0) {
                    storageData.latest_verification_code = codes[0].code;
                }
                
                chrome.storage.local.set(storageData, () => {
                    connectBtn.textContent = 'Connected';
                    connectBtn.disabled = true;
                    
                    // Load verification codes in popup
                    loadStoredVerificationCodes();
                    
                    console.log(`Stored ${codes.length} verification codes`);
                });
            }
        });
        
        // Close the test.html tab after a short delay
        setTimeout(() => {
            chrome.tabs.remove(tabId);
        }, 2000);
        
    } catch (error) {
        console.error('Error handling auth success:', error);
        connectBtn.textContent = 'Connect Gmail';
        connectBtn.disabled = false;
    }
}

// Removed codes list UI

async function fetchGmailMessages(accessToken) {
    console.log('Fetching Gmail messages');
    
    try {
        // List messages
        const listResponse = await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/messages?q=from:no-reply@dgist.ac.kr&maxResults=10`, {
            headers: {
                'Authorization': `Bearer ${accessToken}`
            }
        });
        
        if (!listResponse.ok) {
            throw new Error(`Failed to list messages: ${listResponse.status}`);
        }
        
        const listData = await listResponse.json();
        const messages = listData.messages || [];
        
        console.log(`Found ${messages.length} messages`);
        
        if (messages.length === 0) {
            return;
        }
        
        // Process first 6 messages
        const processedCodes = [];
        for (let i = 0; i < Math.min(messages.length, 6); i++) {
            const message = messages[i];
            
            try {
                const detailResponse = await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/messages/${message.id}`, {
                    headers: {
                        'Authorization': `Bearer ${accessToken}`
                    }
                });
                
                if (!detailResponse.ok) {
                    console.error(`Failed to get message ${message.id}: ${detailResponse.status}`);
                    continue;
                }
                
                const messageData = await detailResponse.json();
                
                // Extract body
                let bodyData = '';
                if (messageData.payload.parts) {
                    bodyData = messageData.payload.parts[0].body.data;
                } else if (messageData.payload.body.data) {
                    bodyData = messageData.payload.body.data;
                }
                
                if (bodyData) {
                    const decoded = atob(bodyData.replace(/-/g, '+').replace(/_/g, '/'));
                    const match = decoded.match(/\b\d{6}\b/);
                    if (match) {
                        const code = match[0];
                        if (!processedCodes.includes(code)) {
                            processedCodes.push(code);
                            
                            // Store the most recent code
                            if (processedCodes.length === 1) {
                                await chrome.storage.local.set({ latest_verification_code: code });
                                console.log('Stored latest verification code:', code);
                            }
                            
                            const date = new Date(parseInt(messageData.internalDate));
                            const formattedDate = date.toLocaleString();

                            // No UI list; only store latest code.
                        }
                    }
                }
            } catch (error) {
                console.error(`Error processing message ${message.id}:`, error);
            }
        }
        
    // Nothing to render in UI
        
    } catch (error) {
        console.error('Error fetching Gmail messages:', error);
    // Silent failure for UI; logs remain
    }
}

async function storeToken(tokenData) {
    return new Promise(resolve => {
        chrome.storage.local.set({ gmail_token: tokenData }, resolve);
    });
}

async function getStoredToken() {
    return new Promise(resolve => {
        chrome.storage.local.get(['gmail_token'], (result) => {
            resolve(result.gmail_token);
        });
    });
}

function isTokenValid(tokenData) {
    if (!tokenData || !tokenData.access_token) {
        return false;
    }
    
    const expirationTime = tokenData.timestamp + (tokenData.expires_in * 1000);
    return Date.now() < expirationTime;
}

function initializeLoginForm() {
    console.log('Initializing login form');
    const form = document.getElementById('loginForm');
    const status = document.getElementById('status');
    
    if (!form || !status) {
        console.error('Form elements not found');
        return;
    }
    
    // Load saved credentials
    chrome.storage.local.get(['dgistUser', 'dgistPass'], function(data) {
        if (data.dgistUser) document.getElementById('username').value = data.dgistUser;
        if (data.dgistPass) document.getElementById('password').value = data.dgistPass;
    });

    // Handle form submission
    form.onsubmit = function(e) {
        e.preventDefault();
        console.log('Form submitted');
        
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
                console.log('Credentials saved');
            }
        );
    };
}
