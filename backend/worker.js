
// Fonction asynchrone pour hacher le mot de passe en utilisant l'algorithme PBKDF2.
// C'est essentiel pour ne pas stocker les mots de passe en clair dans la base de données.
async function hashPassword(password, salt = null) {
  const enc = new TextEncoder();
  
  // Si aucun "sel" (salt) n'est fourni, on en génère un aléatoire (16 octets).
  // Le sel protège contre les attaques par "rainbow table".
  if (!salt) { salt = crypto.getRandomValues(new Uint8Array(16)); } 
  else { salt = Uint8Array.from(atob(salt), c => c.charCodeAt(0)); }

  // Importation de la clé brute à partir du mot de passe
  const keyMaterial = await crypto.subtle.importKey("raw", enc.encode(password), { name: "PBKDF2" }, false, ["deriveBits", "deriveKey"]);
  
  // Dérivation de la clé (le hachage réel) avec 100,000 itérations pour la sécurité
  const key = await crypto.subtle.deriveKey({ name: "PBKDF2", salt: salt, iterations: 100000, hash: "SHA-256" }, keyMaterial, { name: "AES-GCM", length: 256 }, true, ["encrypt", "decrypt"]);
  
  // Exportation de la clé pour pouvoir la stocker sous forme de chaîne
  const exported = await crypto.subtle.exportKey("raw", key);
  
  // Retourne un objet contenant le hash et le sel convertis en base64
  return { hash: btoa(String.fromCharCode(...new Uint8Array(exported))), salt: btoa(String.fromCharCode(...salt)) };
}

// Fonction pour signer un JSON Web Token (JWT)
// Utilisée pour générer le token d'accès lors de la connexion.
async function signJWT(payload, secret) {
  const header = btoa(JSON.stringify({ alg: "HS256", type: "JWT" }));
  const body = btoa(JSON.stringify(payload));
  const enc = new TextEncoder();
  
  // Importation de la clé secrète (JWT_SECRET)
  const key = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  
  // Création de la signature HMAC
  const signature = await crypto.subtle.sign("HMAC", key, enc.encode(`${header}.${body}`));
  
  // Assemblage du token (Header.Body.Signature) en format URL-safe
  return `${header}.${body}.${btoa(String.fromCharCode(...new Uint8Array(signature))).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_")}`;
}

// Fonction pour vérifier la validité d'un JWT entrant
// Utilisée pour protéger les routes privées (comme /chat).
async function verifyJWT(token, secret) {
  try {
    const [header, body, signature] = token.split(".");
    const enc = new TextEncoder();
    
    // Importation de la clé secrète pour vérifier la signature
    const key = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["verify"]);
    
    // Normalisation de la signature (remplacement des caractères URL-safe)
    let signStr = signature.replace(/-/g, "+").replace(/_/g, "/");
    while (signStr.length % 4) signStr += "=";
    
    // Vérification cryptographique
    const valid = await crypto.subtle.verify("HMAC", key, Uint8Array.from(atob(signStr), c => c.charCodeAt(0)), enc.encode(`${header}.${body}`));
    
    // Si valide, on retourne le contenu (payload) du token, sinon null
    return valid ? JSON.parse(atob(body)) : null;
  } catch (e) { return null; }
}

// ==========================================
// HANDLER PRINCIPAL (CLOUDFLARE WORKER)
// ==========================================
export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const method = request.method;
    
    // Configuration des headers CORS pour permettre les requêtes depuis le frontend
    const corsHeaders = {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "POST, GET, DELETE, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Authorization",
    };

    // Gestion des requêtes "preflight" (OPTIONS) pour CORS
    if (method === "OPTIONS") return new Response(null, { headers: corsHeaders });

    // --- AUTHENTIFICATION : INSCRIPTION (SIGNUP) ---
    if (url.pathname === "/auth/signup" && method === "POST") {
      // Récupération des données, y compris le nom d'utilisateur
      const { email, password, username } = await request.json(); 
      const id = crypto.randomUUID(); // Génération d'un ID unique
      
      // Hachage du mot de passe
      const { hash, salt } = await hashPassword(password);
      try {
        // Insertion du nouvel utilisateur dans la base de données D1
        // Utilisation de requêtes préparées pour la sécurité (anti-SQL Injection)
        await env.DB.prepare("INSERT INTO users (id, username, email, password_hash, salt) VALUES (?, ?, ?, ?, ?)").bind(id, username, email, hash, salt).run();
        
        return new Response(JSON.stringify({ success: true }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
      } catch (e) { 
        // Gestion d'erreur (ex: email déjà existant)
        return new Response(JSON.stringify({ error: "Email exists or Error" }), { status: 400, headers: corsHeaders }); 
      }
    }

    // --- AUTHENTIFICATION : CONNEXION (LOGIN) ---
    if (url.pathname === "/auth/login" && method === "POST") {
      const { email, password } = await request.json();
      
      // Recherche de l'utilisateur par email dans D1 
      const user = await env.DB.prepare("SELECT * FROM users WHERE email = ?").bind(email).first();
      if (!user) return new Response("User not found", { status: 401, headers: corsHeaders });
      
      // Vérification du mot de passe en utilisant le sel stocké
      const { hash } = await hashPassword(password, user.salt);
      if (hash !== user.password_hash) return new Response("Invalid pass", { status: 401, headers: corsHeaders });
      
      // Génération du JWT si les identifiants sont corrects
      const token = await signJWT({ id: user.id, email: user.email }, env.JWT_SECRET);
      
      // Retourne le token et l'ID utilisateur au client
      return new Response(JSON.stringify({ token, userId: user.id }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // --- MIDDLEWARE D'AUTHENTIFICATION ---
    // Vérification globale du token pour toutes les routes ci-dessous
    const authHeader = request.headers.get("Authorization");
    if (!authHeader) return new Response("Unauthorized", { status: 401, headers: corsHeaders });
    
    // Extraction et validation du token Bearer
    const userPayload = await verifyJWT(authHeader.split(" ")[1], env.JWT_SECRET);
    if (!userPayload) return new Response("Invalid Token", { status: 403, headers: corsHeaders });

    // --- ROUTE : CHAT AVEC GEMINI ---
    if (url.pathname === "/chat" && method === "POST") {
      const { message, sessionId } = await request.json();
      const userId = userPayload.id;

      // Configuration de l'appel à l'API Gemini
      const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${env.GEMINI_API_KEY}`;
      
      // Envoi du message utilisateur à Gemini
      const geminiResp = await fetch(geminiUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ contents: [{ parts: [{ text: message }] }] })
      });
      
      // Parsing de la réponse de l'IA
      const data = await geminiResp.json();
      const botReply = data.candidates?.[0]?.content?.parts?.[0]?.text || "Error from AI";

      // --- GESTION DE L'HISTORIQUE (KV) ---
      // Clé unique pour stocker l'historique de cet utilisateur dans KV
      const historyKey = `user:${userId}:history`;
      let history = await env.CHAT_HISTORY.get(historyKey, { type: "json" }) || [];
      
      const timestamp = Date.now();
      // Ajout du message utilisateur et de la réponse du bot à l'historique
      history.push({ role: "user", text: message, sessionId, timestamp });
      history.push({ role: "bot", text: botReply, sessionId, timestamp });
      
      // Limitation de l'historique aux 100 derniers messages pour économiser de l'espace
      if (history.length > 100) history = history.slice(-100);
      
      // Sauvegarde du nouvel historique dans Cloudflare KV
      await env.CHAT_HISTORY.put(historyKey, JSON.stringify(history));

      return new Response(JSON.stringify({ reply: botReply }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // --- ROUTE : RÉCUPÉRER L'HISTORIQUE ---
    if (url.pathname === "/history" && method === "GET") {
      // Lecture directe depuis le KV
      const history = await env.CHAT_HISTORY.get(`user:${userPayload.id}:history`, { type: "json" }) || [];
      return new Response(JSON.stringify(history), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // --- ROUTE : SUPPRIMER UNE SESSION D'HISTORIQUE ---
    if (url.pathname === "/history" && method === "DELETE") {
        const { sessionId } = await request.json();
        const historyKey = `user:${userPayload.id}:history`;
        let history = await env.CHAT_HISTORY.get(historyKey, { type: "json" }) || [];
        
        // Filtrage pour retirer les messages correspondant à la sessionID donnée
        const newHistory = history.filter(m => m.sessionId !== sessionId);
        
        // Mise à jour du KV avec la liste nettoyée
        await env.CHAT_HISTORY.put(historyKey, JSON.stringify(newHistory));
        return new Response(JSON.stringify({ success: true }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // Route par défaut (404)
    return new Response("Not Found", { status: 404, headers: corsHeaders });
  }
};