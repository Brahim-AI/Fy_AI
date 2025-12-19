// --- Config ---
//  https://091a2328.brahim-chat.pages.dev
const API_URL = "https://gemini-chat-app.brahim-chat.workers.dev"; 

// --- Init ---
document.addEventListener("DOMContentLoaded", () => {
    const token = localStorage.getItem("token");
    const path = window.location.pathname;

    // Auth Check
    if (!token && path.includes("chat.html")) {
        window.location.href = "login.html";
    } else if (token && (path.includes("login.html") || path.includes("signup.html"))) {
        window.location.href = "chat.html";
    }

    if (path.includes("chat.html")) initChatPage();
});

// --- Auth Functions ---
async function login(e) {
    e.preventDefault();
    const email = document.getElementById("email").value;
    const password = document.getElementById("password").value;
    try {
        const res = await fetch(`${API_URL}/auth/login`, {
            method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ email, password })
        });
        if (res.ok) {
            const data = await res.json();
            localStorage.setItem("token", data.token);
            window.location.href = "chat.html";
        } else alert("Invalid credentials");
    } catch(err) { alert("Network Error"); }
}

async function signup(e) {
    e.preventDefault();

    const username = document.getElementById("username").value;
    const email = document.getElementById("email").value;
    const password = document.getElementById("password").value;
    const confirmPassword = document.getElementById("confirmPassword").value;

    if (password !== confirmPassword) {
        alert("Passwords do not match!");
        return;
    }

    try {
        const res = await fetch(`${API_URL}/auth/signup`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ username, email, password }) 
        });

        if (res.ok) {
            alert("Account created successfully! Please login.");
            window.location.href = "login.html";
        } else {
            const data = await res.json();
            alert(data.error || "Signup failed. Please try again.");
        }
    } catch (err) {
        console.error("Signup Error:", err);
        alert("Network Error. Please check your connection.");
    }
}

function logout() { localStorage.clear(); window.location.href = "login.html"; }

// --- Chat Logic ---
function initChatPage() { loadChatHistory(); }

function getSessionId() {
    let sid = localStorage.getItem("currentSessionId");
    if (!sid) { sid = crypto.randomUUID(); localStorage.setItem("currentSessionId", sid); }
    return sid;
}

function startNewChat() {
    localStorage.setItem("currentSessionId", crypto.randomUUID());
    const chatWindow = document.getElementById("chatWindow");
    
    // UPDATED: Use auto_awesome icon
    chatWindow.innerHTML = `
        <div class="message-wrapper bot-wrapper">
            <div class="bot-avatar">
                <span class="material-symbols-outlined" style="color: #0ea5e9;">auto_awesome</span>
            </div>
            <div class="bot-message-content">New session started. How can I create value for you?</div>
        </div>
    `;
    loadChatHistory();
    if(window.innerWidth <= 768) toggleSidebar();
}

async function sendMessage() {
    const input = document.getElementById("msgInput");
    const sendBtn = document.querySelector(".send-btn");
    const message = input.value.trim();
    if (!message) return;

    input.disabled = true;
    sendBtn.disabled = true;
    sendBtn.classList.add("disabled");

    const sessionId = getSessionId();

    renderMessage(message, "user");
    input.value = "";
    
    const typingId = renderTyping();

    try {
        const res = await fetch(`${API_URL}/chat`, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "Authorization": `Bearer ${localStorage.getItem("token")}`
            },
            body: JSON.stringify({ message, sessionId })
        });
        const data = await res.json();
        
        document.getElementById(typingId)?.remove();
        renderMessage(data.reply, "bot");
        loadChatHistory(); 

    } catch (e) {
        document.getElementById(typingId)?.remove();
        renderMessage("Connection Error.", "bot");
    } finally {
        input.disabled = false;
        sendBtn.disabled = false;
        sendBtn.classList.remove("disabled");
        input.focus();
    }
}

// --- RENDER LOGIC
function renderMessage(text, sender) {
    const chatWindow = document.getElementById("chatWindow");
    
    const wrapper = document.createElement("div");
    wrapper.classList.add("message-wrapper", sender === "user" ? "user-wrapper" : "bot-wrapper");

    const formattedText = text.replace(/\*\*(.*?)\*\*/g, '<b>$1</b>').replace(/\n/g, '<br>');

    if (sender === "user") {
        wrapper.innerHTML = `<div class="user-message-content">${formattedText}</div>`;
    } else {
        // UPDATED: Use auto_awesome icon
        wrapper.innerHTML = `
            <div class="bot-avatar">
                <span class="material-symbols-outlined" style="color: #0ea5e9;">auto_awesome</span>
            </div>
            <div class="bot-message-content">${formattedText}</div>
        `;
    }

    chatWindow.appendChild(wrapper);
    chatWindow.scrollTop = chatWindow.scrollHeight;
}

function renderTyping() {
    const chatWindow = document.getElementById("chatWindow");
    const id = "typing-" + Date.now();
    const wrapper = document.createElement("div");
    wrapper.id = id;
    wrapper.classList.add("message-wrapper", "bot-wrapper");
    
    // UPDATED: Use auto_awesome icon
    wrapper.innerHTML = `
        <div class="bot-avatar">
            <span class="material-symbols-outlined" style="color: #0ea5e9;">auto_awesome</span>
        </div>
        <div class="bot-message-content">
            <div class="typing-dots"><div class="dot"></div><div class="dot"></div><div class="dot"></div></div>
        </div>
    `;
    chatWindow.appendChild(wrapper);
    chatWindow.scrollTop = chatWindow.scrollHeight;
    return id;
}

// --- History Logic ---
async function loadChatHistory() {
    try {
        const token = localStorage.getItem("token");
        if(!token) return;
        const res = await fetch(`${API_URL}/history`, { headers: { "Authorization": `Bearer ${token}` } });
        if(!res.ok) return;
        const history = await res.json();
        
        const sessionsList = document.getElementById("sessionsList");
        sessionsList.innerHTML = "";
        
        const grouped = {};
        history.forEach(m => {
            const sid = m.sessionId || "old";
            if(!grouped[sid]) grouped[sid] = [];
            grouped[sid].push(m);
        });

        Object.keys(grouped).reverse().forEach(sid => {
            const msgs = grouped[sid];
            const firstMsg = msgs.find(m => m.role === "user")?.text || "Chat";
            const title = firstMsg.substring(0, 20) + (firstMsg.length>20?"...":"");
            
            const item = document.createElement("div");
            item.className = "history-item";
            if(sid === localStorage.getItem("currentSessionId")) item.classList.add("active-chat");
            
            item.innerHTML = `
                <div style="display:flex; align-items:center; gap:10px; flex:1; overflow:hidden;">
                    <span class="material-symbols-outlined" style="font-size:1rem">chat_bubble</span> 
                    <span style="white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">${title}</span>
                </div>
                <span class="material-symbols-outlined delete-icon" title="Delete Chat">delete</span>
            `;
            
            item.onclick = (e) => {
                localStorage.setItem("currentSessionId", sid);
                document.getElementById("chatWindow").innerHTML = "";
                msgs.forEach(m => renderMessage(m.text, m.role));
                loadChatHistory();
                if(window.innerWidth <= 768) toggleSidebar();
            };

            const deleteBtn = item.querySelector(".delete-icon");
            deleteBtn.onclick = (e) => {
                e.stopPropagation(); 
                deleteSession(sid);
            };

            sessionsList.appendChild(item);
        });
    } catch(e){}
}

async function deleteSession(sessionId) {
    if(!confirm("Are you sure you want to delete this chat?")) return;
    try {
        const res = await fetch(`${API_URL}/history`, {
            method: "DELETE",
            headers: { 
                "Content-Type": "application/json",
                "Authorization": `Bearer ${localStorage.getItem("token")}`
            },
            body: JSON.stringify({ sessionId })
        });
        
        if(res.ok) {
            if(sessionId === localStorage.getItem("currentSessionId")) {
                startNewChat();
            } else {
                loadChatHistory();
            }
        }
    } catch(e) { alert("Could not delete chat"); }
}

function toggleSidebar() {
    document.querySelector('.sidebar').classList.toggle('active');
    document.querySelector('.sidebar-overlay').classList.toggle('active');
}