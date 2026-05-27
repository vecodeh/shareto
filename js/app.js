// ─────────────────────────────────────────────
// UTILS
// ─────────────────────────────────────────────
function randomId() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  return Array.from({length: 4}, () => chars[Math.floor(Math.random() * chars.length)]).join('');
}

function formatBytes(b) {
  if (b < 1024) return b + ' B';
  if (b < 1048576) return (b/1024).toFixed(1) + ' KB';
  return (b/1048576).toFixed(1) + ' MB';
}

function fileCategory(name) {
  const ext = name.split('.').pop().toLowerCase();
  if (['jpg','jpeg','png','gif','webp','svg','bmp'].includes(ext)) return {cat:'img', icon:'🖼️'};
  if (['pdf','doc','docx','txt','md','rtf','odt','ppt','pptx','xls','xlsx'].includes(ext)) return {cat:'doc', icon:'📄'};
  if (['zip','rar','7z','tar','gz'].includes(ext)) return {cat:'zip', icon:'📦'};
  return {cat:'other', icon:'📎'};
}

let toastTimer;
function showToast(msg, type='success') {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.className = `show ${type}`;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 3000);
}

function fmt(cmd) {
  if (cmd === 'code') {
    const sel = window.getSelection();
    if (sel && sel.rangeCount && sel.toString()) {
      const range = sel.getRangeAt(0);
      const code = document.createElement('code');
      range.surroundContents(code);
    }
  } else {
    document.execCommand(cmd, false, null);
  }
  document.getElementById('msg-input').focus();
}

// ─────────────────────────────────────────────
// STATE
// ─────────────────────────────────────────────
let peer = null;
let myId = '';
let connections = {}; // peerId → conn
let activePeerId = null;
let pendingConn = null;

// File transfer state
const fileReceive = {}; // peerId → {name, size, mime, chunks, received}

// ─────────────────────────────────────────────
// PEER SETUP
// ─────────────────────────────────────────────
function initPeer() {
  myId = randomId();
  updateStatus('connecting');

  peer = new Peer(myId, {
    // Using PeerJS cloud signaling (free, for GitHub Pages)
    debug: 0
  });

  peer.on('open', id => {
    myId = id;
    document.getElementById('my-id-display').textContent = myId;
    document.getElementById('modal-id-display').textContent = myId;
    updateStatus('idle');
    document.getElementById('btn-connect').disabled = false;
    showToast(`Seu ID: ${myId}`, 'success');
  });

  peer.on('connection', conn => {
    pendingConn = conn;
    showIncomingModal(conn.peer);
  });

  peer.on('error', err => {
    console.error(err);
    if (err.type === 'peer-unavailable') {
      showToast('ID não encontrado', 'error');
    } else if (err.type === 'network' || err.type === 'server-error') {
      showToast('Erro de rede, tentando reconectar...', 'error');
      setTimeout(initPeer, 3000);
    }
  });

  peer.on('disconnected', () => {
    updateStatus('connecting');
    peer.reconnect();
  });
}

function updateStatus(state) {
  const pill = document.getElementById('status-pill');
  const txt = document.getElementById('status-text');
  pill.className = 'status-pill';
  if (state === 'connecting') { pill.classList.add('connecting'); txt.textContent = 'Conectando...'; }
  else if (state === 'idle') { txt.textContent = `ID: ${myId}`; }
  else if (state === 'connected') { pill.classList.add('connected'); txt.textContent = `${Object.keys(connections).length} conectado(s)`; }
}

// ─────────────────────────────────────────────
// CONNECT
// ─────────────────────────────────────────────
function connectToPeer() {
  const input = document.getElementById('peer-id-input');
  const targetId = input.value.trim().toUpperCase();
  if (!targetId || targetId.length < 4) return;
  if (targetId === myId) { showToast('Não pode conectar a si mesmo', 'error'); return; }
  if (connections[targetId]) { switchActive(targetId); return; }

  const conn = peer.connect(targetId, { reliable: true });
  setupConnection(conn);
  input.value = '';
}

function setupConnection(conn) {
  function onOpen() {
    connections[conn.peer] = conn;
    addPeerToList(conn.peer);
    switchActive(conn.peer);
    updateStatus('connected');
    appendSystemMsg(conn.peer, '✓ Conectado com sucesso');
  }

  conn.on('open', onOpen);
  conn.on('data', data => handleData(conn.peer, data));

  conn.on('close', () => {
    removeConnection(conn.peer);
  });

  conn.on('error', err => {
    console.error('conn error', err);
    removeConnection(conn.peer);
    showToast(`Erro na conexão com ${conn.peer}`, 'error');
  });

  // Race condition: incoming connections may already be open by the time
  // the user clicks "Accept" and setupConnection is called.
  if (conn.open) {
    onOpen();
  }
}

function removeConnection(peerId) {
  delete connections[peerId];
  removePeerFromList(peerId);
  appendSystemMsg(peerId, '✗ Conexão encerrada');
  if (activePeerId === peerId) {
    if (Object.keys(connections).length === 0) {
      updateStatus('idle');
    } else {
      const remaining = Object.keys(connections)[0];
      switchActive(remaining);
      updateStatus('connected');
    }
  }
}

function disconnectActive() {
  if (!activePeerId) return;
  if (connections[activePeerId]) {
    connections[activePeerId].close();
  }
  removeConnection(activePeerId);
}

// ─────────────────────────────────────────────
// INCOMING
// ─────────────────────────────────────────────
function showIncomingModal(peerId) {
  document.getElementById('incoming-id-display').textContent = peerId;
  document.getElementById('incoming-avatar').textContent = peerId.charAt(0);
  document.getElementById('incoming-modal').classList.add('open');
}

function acceptIncoming() {
  document.getElementById('incoming-modal').classList.remove('open');
  if (pendingConn) {
    setupConnection(pendingConn);
    pendingConn = null;
  }
}

function rejectIncoming() {
  document.getElementById('incoming-modal').classList.remove('open');
  if (pendingConn) {
    pendingConn.close();
    pendingConn = null;
  }
  showToast('Conexão recusada', 'error');
}

// ─────────────────────────────────────────────
// PEERS LIST UI
// ─────────────────────────────────────────────
function addPeerToList(peerId) {
  const list = document.getElementById('peers-list');
  const nopeers = list.querySelector('.no-peers');
  if (nopeers) nopeers.remove();

  const item = document.createElement('div');
  item.className = 'peer-item';
  item.id = `peer-item-${peerId}`;
  item.onclick = () => switchActive(peerId);
  item.innerHTML = `
    <div class="peer-avatar">${peerId.charAt(0)}</div>
    <div class="peer-info">
      <div class="peer-name">${peerId}</div>
      <div class="peer-sub">P2P direto</div>
    </div>
    <div class="peer-dot"></div>
  `;
  list.appendChild(item);
}

function removePeerFromList(peerId) {
  const item = document.getElementById(`peer-item-${peerId}`);
  if (item) item.remove();
  if (document.querySelectorAll('.peer-item').length === 0) {
    document.getElementById('peers-list').innerHTML = '<div class="no-peers">Nenhuma conexão ativa.</div>';
  }
}

// ─────────────────────────────────────────────
// SWITCH ACTIVE PEER
// ─────────────────────────────────────────────
let chatHistories = {}; // peerId → messages div content

function switchActive(peerId) {
  // Save current
  if (activePeerId) {
    const cur = document.getElementById(`peer-item-${activePeerId}`);
    if (cur) cur.classList.remove('active');
    chatHistories[activePeerId] = document.getElementById('messages').innerHTML;
  }

  activePeerId = peerId;
  document.getElementById('chat-name').textContent = peerId;
  document.getElementById('chat-avatar').textContent = peerId.charAt(0);

  const peer_item = document.getElementById(`peer-item-${peerId}`);
  if (peer_item) peer_item.classList.add('active');

  // Restore messages
  const msgs = document.getElementById('messages');
  msgs.innerHTML = chatHistories[peerId] || '';
  msgs.scrollTop = msgs.scrollHeight;

  document.getElementById('welcome-screen').style.display = 'none';
  const chatScreen = document.getElementById('chat-screen');
  chatScreen.style.display = 'flex';
  chatScreen.classList.add('active');

  document.getElementById('btn-send').disabled = !connections[peerId];
}

// ─────────────────────────────────────────────
// MESSAGES
// ─────────────────────────────────────────────
function appendSystemMsg(peerId, text) {
  if (!chatHistories[peerId]) chatHistories[peerId] = '';
  const div = document.createElement('div');
  div.style.cssText = 'text-align:center;font-size:11px;color:var(--muted);font-family:var(--font-mono);padding:4px 0';
  div.textContent = text;

  if (activePeerId === peerId) {
    const msgs = document.getElementById('messages');
    msgs.appendChild(div);
    msgs.scrollTop = msgs.scrollHeight;
  } else {
    chatHistories[peerId] += div.outerHTML;
  }
}

function appendMessage(peerId, content, type, isSent, isHtml = false) {
  const time = new Date().toLocaleTimeString('pt-BR', {hour:'2-digit', minute:'2-digit'});

  const wrap = document.createElement('div');
  wrap.className = `msg ${isSent ? 'sent' : 'received'}`;

  let bubbleHtml = '';
  if (type === 'file') {
    bubbleHtml = content; // already built HTML
  } else {
    const safeContent = isHtml ? content : escapeHtml(content).replace(/\n/g, '<br>');
    bubbleHtml = `
      <div class="msg-bubble formatted-content">${safeContent}</div>
      <div class="msg-actions">
        <button class="btn-action" onclick="copyText(this, \`${encodeURIComponent(getTextContent(safeContent))}\`)">txt</button>
        <button class="btn-action" onclick="copyHtml(this, \`${encodeURIComponent(safeContent)}\`)">html</button>
      </div>
    `;
  }

  wrap.innerHTML = `
    <div class="msg-meta">${isSent ? 'Você' : peerId} · ${time}</div>
    ${bubbleHtml}
  `;

  if (activePeerId === peerId) {
    const msgs = document.getElementById('messages');
    msgs.appendChild(wrap);
    msgs.scrollTop = msgs.scrollHeight;
  } else {
    if (!chatHistories[peerId]) chatHistories[peerId] = '';
    chatHistories[peerId] += wrap.outerHTML;
  }
}

function escapeHtml(s) {
  return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function getTextContent(html) {
  const tmp = document.createElement('div');
  tmp.innerHTML = html;
  return tmp.textContent;
}

// ─────────────────────────────────────────────
// COPY
// ─────────────────────────────────────────────
function copyText(btn, encodedText) {
  navigator.clipboard.writeText(decodeURIComponent(encodedText)).then(() => {
    btn.textContent = '✓ copiado';
    btn.classList.add('copied');
    setTimeout(() => { btn.textContent = 'txt'; btn.classList.remove('copied'); }, 1500);
  });
}

function copyHtml(btn, encodedHtml) {
  const html = decodeURIComponent(encodedHtml);
  const text = getTextContent(html);
  const blob = new Blob([html], {type:'text/html'});
  const blobText = new Blob([text], {type:'text/plain'});
  const item = new ClipboardItem({'text/html': blob, 'text/plain': blobText});
  navigator.clipboard.write([item]).then(() => {
    btn.textContent = '✓ copiado';
    btn.classList.add('copied');
    setTimeout(() => { btn.textContent = 'html'; btn.classList.remove('copied'); }, 1500);
  }).catch(() => {
    navigator.clipboard.writeText(text);
    btn.textContent = '✓ txt';
    setTimeout(() => { btn.textContent = 'html'; }, 1500);
  });
}

function copyMyId() {
  navigator.clipboard.writeText(myId).then(() => showToast('ID copiado!', 'success'));
}

// ─────────────────────────────────────────────
// SEND
// ─────────────────────────────────────────────
function sendMessage() {
  if (!activePeerId || !connections[activePeerId]) return;
  const input = document.getElementById('msg-input');
  const html = input.innerHTML.trim();
  if (!html) return;

  const conn = connections[activePeerId];
  conn.send({ type: 'text', html });
  appendMessage(activePeerId, html, 'text', true, true);
  input.innerHTML = '';
}

async function sendFiles(files) {
  if (!activePeerId || !connections[activePeerId] || !files.length) return;
  const conn = connections[activePeerId];

  for (const file of files) {
    const reader = new FileReader();
    reader.onload = async (e) => {
      const buffer = e.target.result;
      const CHUNK = 16384;
      const totalChunks = Math.ceil(buffer.byteLength / CHUNK);

      // Send metadata
      conn.send({ type: 'file-meta', name: file.name, size: file.size, mime: file.type, totalChunks });

      // Show progress
      showProgress(`Enviando ${file.name}`, 0);

      for (let i = 0; i < totalChunks; i++) {
        const chunk = buffer.slice(i * CHUNK, (i + 1) * CHUNK);
        conn.send({ type: 'file-chunk', chunk, index: i, total: totalChunks });
        const pct = Math.round(((i + 1) / totalChunks) * 100);
        showProgress(`Enviando ${file.name}`, pct);
        // Yield to avoid blocking
        if (i % 10 === 0) await new Promise(r => setTimeout(r, 1));
      }

      hideProgress();
      const {cat, icon} = fileCategory(file.name);
      const fileBubble = buildFileBubble(file.name, file.size, null, icon, cat);
      appendMessage(activePeerId, fileBubble, 'file', true);
      showToast(`Arquivo enviado: ${file.name}`, 'success');
    };
    reader.readAsArrayBuffer(file);
  }
  document.getElementById('file-input').value = '';
}

function buildFileBubble(name, size, url, icon, cat) {
  const href = url ? `href="${url}" download="${name}"` : '';
  const tag = url ? 'a' : 'div';
  return `
    <${tag} class="file-bubble" ${href} target="_blank">
      <div class="file-icon ${cat}">${icon}</div>
      <div class="file-details">
        <div class="file-name">${escapeHtml(name)}</div>
        <div class="file-size">${formatBytes(size)}</div>
      </div>
      <div class="file-dl">${url ? '⬇' : '📤'}</div>
    </${tag}>
  `;
}

function showProgress(label, pct) {
  const el = document.getElementById('transfer-progress');
  el.classList.add('active');
  document.getElementById('transfer-label').textContent = label;
  document.getElementById('progress-fill').style.width = pct + '%';
  document.getElementById('transfer-pct').textContent = pct + '%';
}

function hideProgress() {
  document.getElementById('transfer-progress').classList.remove('active');
}

// ─────────────────────────────────────────────
// RECEIVE
// ─────────────────────────────────────────────
function handleData(fromPeer, data) {
  if (data.type === 'text') {
    appendMessage(fromPeer, data.html, 'text', false, true);
    if (activePeerId !== fromPeer) showToast(`Nova mensagem de ${fromPeer}`, 'success');
  }

  else if (data.type === 'file-meta') {
    fileReceive[fromPeer] = {
      name: data.name,
      size: data.size,
      mime: data.mime,
      totalChunks: data.totalChunks,
      chunks: new Array(data.totalChunks),
      received: 0
    };
  }

  else if (data.type === 'file-chunk') {
    const state = fileReceive[fromPeer];
    if (!state) return;
    state.chunks[data.index] = data.chunk;
    state.received++;
    const pct = Math.round((state.received / state.totalChunks) * 100);
    if (activePeerId === fromPeer) showProgress(`Recebendo ${state.name}`, pct);

    if (state.received === state.totalChunks) {
      hideProgress();
      // Assemble
      const totalBytes = state.chunks.reduce((a, c) => a + c.byteLength, 0);
      const merged = new Uint8Array(totalBytes);
      let offset = 0;
      for (const chunk of state.chunks) {
        merged.set(new Uint8Array(chunk), offset);
        offset += chunk.byteLength;
      }
      const blob = new Blob([merged], {type: state.mime || 'application/octet-stream'});
      const url = URL.createObjectURL(blob);
      const {cat, icon} = fileCategory(state.name);
      const fileBubble = buildFileBubble(state.name, state.size, url, icon, cat);
      appendMessage(fromPeer, fileBubble, 'file', false);
      showToast(`Arquivo recebido: ${state.name}`, 'success');
      delete fileReceive[fromPeer];
    }
  }
}

// ─────────────────────────────────────────────
// SHOW ID MODAL
// ─────────────────────────────────────────────
function showIdModal() {
  document.getElementById('id-modal').classList.add('open');
}

// ─────────────────────────────────────────────
// INPUT EVENTS
// ─────────────────────────────────────────────
document.getElementById('msg-input').addEventListener('keydown', e => {
  if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
    e.preventDefault();
    sendMessage();
  }
});

document.getElementById('peer-id-input').addEventListener('input', e => {
  e.target.value = e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '');
});

document.getElementById('peer-id-input').addEventListener('keydown', e => {
  if (e.key === 'Enter') connectToPeer();
});

// Close modals on overlay click
document.querySelectorAll('.modal-overlay').forEach(el => {
  el.addEventListener('click', e => {
    if (e.target === el) el.classList.remove('open');
  });
});

// Drag & drop files
document.addEventListener('dragover', e => e.preventDefault());
document.addEventListener('drop', e => {
  e.preventDefault();
  if (activePeerId && connections[activePeerId] && e.dataTransfer.files.length) {
    sendFiles(e.dataTransfer.files);
  }
});

// ─────────────────────────────────────────────
// INIT
// ─────────────────────────────────────────────
initPeer();
