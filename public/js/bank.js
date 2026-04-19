/**
 * js/bank.js - Integrazione Plaid (Open Banking)
 */

/**
 * Carica dinamicamente lo script Plaid Link CDN.
 * Evita l'errore 'Plaid is not defined' dovuto a timing del CDN o CSP.
 */
function loadPlaidScript() {
    return new Promise((resolve, reject) => {
        // Se già caricato, resolvi subito
        if (typeof Plaid !== 'undefined') return resolve();
        // Se già in corso di caricamento, aspetta
        const existing = document.getElementById('plaid-link-script');
        if (existing) {
            existing.addEventListener('load', resolve);
            existing.addEventListener('error', reject);
            return;
        }
        const script = document.createElement('script');
        script.id = 'plaid-link-script';
        script.src = 'https://cdn.plaid.com/link/v2/stable/link-initialize.js';
        script.onload = resolve;
        script.onerror = () => reject(new Error('Impossibile caricare la libreria Plaid Link.'));
        document.head.appendChild(script);
    });
}

// Inizializzazione al caricamento
document.addEventListener('DOMContentLoaded', () => {
    try {
        const saved = JSON.parse(localStorage.getItem('accountsRequiringUpdate') || '[]');
        window.accountsRequiringUpdate = new Set(saved);
    } catch { window.accountsRequiringUpdate = new Set(); }
    // Caricamento conti se siamo nella tab giusta all'avvio
    if (window.location.hash === '#bank') {
        loadBankAccounts();
    }
});

/**
 * Avvia il flusso Plaid Link (sostituisce il vecchio selettore manuale)
 */
async function showBankSelector() {
    try {
        // Carica (o attendi) lo script Plaid prima di usarlo
        await loadPlaidScript();

        const token = getAuthToken();
        const btn = document.querySelector('button[onclick="showBankSelector()"]');
        if(btn) {
            btn.disabled = true;
            btn.innerHTML = '<div class="spinner-wheel-small" style="display:inline-block; margin-right: 8px;"></div> Inizializzazione...';
        }

        // 1. Chiedi al backend un Link Token
        const response = await fetch('/api/bank/create-link-token', {
            method: 'POST',
            headers: { 
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json' 
            }
        });
        
        const result = await response.json();
        
        if (btn) {
            btn.disabled = false;
            btn.innerHTML = '+ Collega Ora';
        }

        if (result.success && result.link_token) {
            // 2. Apri il popup Plaid Link usando lo script CDN inserito in index.html
            const handler = Plaid.create({
                token: result.link_token,
                onSuccess: async (public_token, metadata) => {
                    console.log('Plaid onSuccess', metadata);
                    showMessage('🔗 Connessione riuscita, salvataggio dati...', 'info');
                    
                    // 3. Invia public_token al nostro backend per ottenere access_token
                    const exchangeRes = await fetch('/api/bank/exchange-public-token', {
                        method: 'POST',
                        headers: { 
                            'Authorization': `Bearer ${token}`,
                            'Content-Type': 'application/json' 
                        },
                        body: JSON.stringify({ 
                            public_token: public_token,
                            institution_id: metadata.institution ? metadata.institution.institution_id : null,
                            institution_name: metadata.institution ? metadata.institution.name : null
                        })
                    });

                    const exchangeResult = await exchangeRes.json();
                    if(exchangeResult.success) {
                        showMessage('🏦 Banca collegata! Avvio prima sincronizzazione...', 'info');
                        await loadBankAccounts();
                        // Auto-sync: recupera subito i movimenti per i nuovi conti
                        const accountsRes = await fetch('/api/bank/accounts', { headers: { 'Authorization': `Bearer ${token}` } });
                        const accountsData = await accountsRes.json();
                        if (accountsData.success) {
                            const newAccounts = accountsData.data.filter(a => !a.lastSync);
                            if (newAccounts.length > 0) {
                                showMessage(`🔄 Scarico ${newAccounts.length} conto/i...`, 'info');
                                await Promise.all(newAccounts.map(acc => syncAccount(acc.id, null)));
                            }
                        }
                        showMessage('✅ Banca collegata e transazioni sincronizzate!', 'success');
                    } else {
                        showMessage(exchangeResult.error || 'Errore nel salvataggio della banca', 'error');
                    }
                },
                onLoad: () => {
                    // Opzionale: fai qualcosa quando il caricamento è finito
                },
                onExit: (err, metadata) => {
                    if (err != null) {
                        console.error('Errore Plaid:', err);
                        showMessage('Chiusura o errore imprevisto: ' + err.error_message, 'error');
                    }
                },
            });
            handler.open();
        } else {
            showMessage(result.error || 'Errore generazione token Plaid', 'error');
        }
    } catch (error) {
        console.error("Errore critico connectBank:", error);
        showMessage('Errore critico durante l\'inizializzazione', 'error');
    }
}

/**
 * Carica i conti dell'utente
 */
async function loadBankAccounts() {
    const listEl = document.getElementById('bankAccountsList');
    if (!listEl) return;

    listEl.innerHTML = '<div style="text-align: center; padding: 30px; opacity: 0.6;"><div class="spinner-wheel" style="margin: 0 auto 15px;"></div>Caricamento conti...</div>';

    try {
        const token = getAuthToken();
        const response = await fetch('/api/bank/accounts', {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        
        const result = await response.json();
        if (result.success) {
            renderAccounts(result.data);
        } else {
            listEl.innerHTML = `<div style="color: #f87171; padding: 20px; text-align:center;">${result.error}</div>`;
        }
    } catch (error) {
        console.error('Errore caricamento conti:', error);
        listEl.innerHTML = `<div style="color: #f87171; padding: 20px; text-align:center;">Errore di connessione</div>`;
    }
}

/**
 * Renderizza i conti collegati
 */
function renderAccounts(accounts) {
    const listEl = document.getElementById('bankAccountsList');
    
    if (accounts.length === 0) {
        listEl.innerHTML = `
            <div class="tab-empty-state">
                <i data-lucide="landmark" class="tab-empty-icon"></i>
                <div class="tab-empty-title">Nessuna banca collegata</div>
                <div class="tab-empty-sub">Collega i tuoi conti per sincronizzare le spese in tempo reale</div>
            </div>
        `;
        if (typeof lucide !== 'undefined') lucide.createIcons();
        return;
    }

    // 🏷️ RAGGRUPPAMENTO CONTI
    const groups = {
        connected: accounts.filter(a => a.isEnabled && a.isConnected),
        ready: accounts.filter(a => a.isEnabled && !a.isConnected),
        hidden: accounts.filter(a => !a.isEnabled)
    };

    let html = '';

    // Header per conti collegati
    if (groups.connected.length > 0) {
        html += `
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 20px; padding: 0 5px;">
            <div style="display: flex; align-items: center; gap: 8px;">
                <div style="width: 8px; height: 8px; border-radius: 50%; background: #4ade80;"></div>
                <span style="font-weight: 600; font-size: 14px; text-transform: uppercase; letter-spacing: 0.5px; opacity: 0.8;">Conti Collegati al Budget</span>
            </div>
            <button class="btn" onclick="syncAllConnectedAccounts(this)" style="width: auto; padding: 10px 18px; font-size: 13px; background: rgba(74, 222, 128, 0.1); border: 1px solid rgba(74, 222, 128, 0.2); color: #4ade80; border-radius: 10px;">
                <i data-lucide="refresh-cw" style="width: 14px; height: 14px; margin-right: 6px; vertical-align: middle;"></i> Aggiorna Saldi
            </button>
        </div>
        `;
        html += groups.connected.map(acc => renderAccountCard(acc)).join('');
    }

    if (groups.ready.length > 0) {
        html += `
        <div style="display: flex; align-items: center; gap: 8px; margin: 35px 0 20px; padding: 0 5px;">
            <div style="width: 8px; height: 8px; border-radius: 50%; background: #f59e0b;"></div>
            <span style="font-weight: 600; font-size: 14px; text-transform: uppercase; letter-spacing: 0.5px; opacity: 0.8;">Pronti per la Sincronia</span>
        </div>
        `;
        html += groups.ready.map(acc => renderAccountCard(acc)).join('');
    }

    if (groups.hidden.length > 0) {
        html += `
        <div style="display: flex; align-items: center; gap: 8px; margin: 35px 0 20px; padding: 0 5px;">
            <div style="width: 8px; height: 8px; border-radius: 50%; background: #94a3b8;"></div>
            <span style="font-weight: 600; font-size: 14px; text-transform: uppercase; letter-spacing: 0.5px; opacity: 0.8;">Conti Nascosti</span>
        </div>
        `;
        html += groups.hidden.map(acc => renderAccountCard(acc)).join('');
    }

    // Bottone extra in fondo per collegare un'altra banca
    html += `
        <div style="text-align: center; margin-top: 40px; padding-bottom: 20px;">
           <button class="btn" onclick="showBankSelector()" style="width: auto; font-size: 14px; padding: 12px 30px; background: rgba(255,255,255,0.03); border: 1px solid rgba(255,255,255,0.1); border-radius: 12px;">
             <i data-lucide="plus" style="width: 18px; height: 18px; margin-right: 8px; vertical-align: middle;"></i> Collega un altro conto
            </button>
        </div>
    `;

    listEl.innerHTML = html;
    if (typeof lucide !== 'undefined') lucide.createIcons();
}

/**
 * Renderizza la singola card del conto
 */
function renderAccountCard(acc) {
    const conn = acc.connection || {};
    const bankName = conn.institutionName || 'Banca';
    const bankColor = conn.institutionColor || '#4facfe';
    const bankLogo = conn.institutionLogo;
    
    const colorAlpha = `${bankColor}33`; 
    const styleTag = `style="--bank-color: ${bankColor}; --bank-color-alpha: ${colorAlpha};"`;

    const isReady = acc.isEnabled && !acc.isConnected;
    const isConnected = acc.isEnabled && acc.isConnected;
    const isDisabled = !acc.isEnabled;

    return `
    <div class="bank-account-card ${isDisabled ? 'disabled' : ''} ${isReady ? 'ready-state' : ''}" ${styleTag}>
        <div class="bank-card-glow"></div>
        <div class="bank-info-primary" style="${isDisabled ? 'opacity: 0.5;' : ''}">
            <div class="bank-identity">
                <div class="bank-logo-container">
                    ${bankLogo 
                        ? `<img src="data:image/png;base64,${bankLogo}" class="bank-logo-img" alt="${bankName}">`
                        : `<div class="bank-logo-fallback">${bankName.charAt(0)}</div>`
                    }
                </div>
                <div class="bank-name-group">
                    <div class="bank-institution-label">${bankName}</div>
                    <h4>${acc.name}</h4>
                    <div style="font-size: 13px; opacity: 0.5;">${acc.ownerName || 'Conto Personale'}</div>
                </div>
            </div>
            <div class="bank-balance-group">
                <div style="display: flex; align-items: baseline; gap: 8px; justify-content: flex-end;">
                  <div class="bank-balance-value" id="balance-${acc.id}">€ ${parseFloat(acc.balance || 0).toFixed(2)}</div>
                  <button onclick="refreshAccountBalance('${acc.id}', this)" class="btn-icon-mini" title="Aggiorna Saldo Real-time" style="background: transparent; border: none; color: var(--text-muted); padding: 0; cursor: pointer; display: flex; align-items: center; transition: all 0.2s ease;">
                    <i data-lucide="refresh-cw" style="width: 14px; height: 14px;"></i>
                  </button>
                </div>
                <div class="bank-balance-label">Saldo Disponibile</div>
            </div>
        </div>

        <div class="bank-card-footer">
            <div class="bank-status-pill ${isDisabled ? 'status-off' : (isReady ? 'status-ready' : 'status-on')}" 
                    style="${isReady ? 'background: rgba(245, 158, 11, 0.1); border: 1px solid rgba(245, 158, 11, 0.2); color: #f59e0b;' : ''}">
                <div class="bank-status-dot" style="${isReady ? 'background: #f59e0b; box-shadow: 0 0 10px #f59e0b;' : ''}"></div>
                ${isDisabled ? 'Nascosto' : (isReady ? 'PRONTO' : 'COLLEGATO')}
            </div>
            
            <div style="display: flex; gap: 10px; align-items: center;">
                <div style="font-size: 11px; opacity: 0.4; text-align: right; margin-right: 10px;">
                    Ultimo Aggiornamento<br>
                    <strong>${acc.lastSync ? new Date(acc.lastSync).toLocaleString('it-IT', { day:'2-digit', month:'2-digit', hour:'2-digit', minute:'2-digit' }) : 'Mai'}</strong>
                </div>

                <button onclick="toggleAccountVisibility('${acc.id}', this)" class="btn" style="width: auto; padding: 10px; background: ${acc.isEnabled ? 'rgba(99, 102, 241, 0.1)' : 'rgba(255, 255, 255, 0.05)'}; border: 1px solid ${acc.isEnabled ? 'rgba(99, 102, 241, 0.2)' : 'rgba(255, 255, 255, 0.1)'}; color: ${acc.isEnabled ? 'var(--accent-primary)' : 'var(--text-muted)'}; border-radius: 12px;" title="${acc.isEnabled ? 'Nascondi dal budget' : 'Mostra nel budget'}">
                    <i data-lucide="${acc.isEnabled ? 'eye' : 'eye-off'}" style="width: 16px; height: 16px;"></i>
                </button>

                <button onclick="disconnectConnection('${conn.id}', this)" class="btn" style="width: auto; padding: 10px; background: rgba(239, 68, 68, 0.1); border: 1px solid rgba(239, 68, 68, 0.2); color: #f87171; border-radius: 12px;" title="Scollega">
                    <i data-lucide="power" style="width: 16px; height: 16px;"></i>
                </button>
                
                ${!isDisabled ? (
                  (window.accountsRequiringUpdate && window.accountsRequiringUpdate.has(acc.id)) ? `
                    <button onclick="startUpdateMode('${acc.id}')" class="btn" style="width: auto; padding: 10px 20px; font-size: 14px; border-radius: 12px; background: rgba(245, 158, 11, 0.1); border: 1px solid rgba(245, 158, 11, 0.2); color: #f59e0b;">
                        <i data-lucide="alert-triangle" style="width: 16px; height: 16px; margin-right: 8px; vertical-align: middle;"></i>
                        Risolvi Errore
                    </button>
                  ` : `
                    <button onclick="syncAccount('${acc.id}', this)" class="btn bank-sync-btn" style="width: auto; padding: 10px 20px; font-size: 14px; border-radius: 12px; color: white;">
                        <i data-lucide="refresh-cw" style="width: 16px; height: 16px; margin-right: 8px; vertical-align: middle;"></i>
                        Aggiorna Saldo
                    </button>
                  `
                ) : ''}
            </div>
        </div>
    </div>
    `;
}

/**
 * Scollega definitivamente una banca
 */
async function disconnectConnection(connectionId, btn) {
    if (!confirm('Sei sicuro? Questa azione scollegherà la banca e cancellerà definitivamente il collegamento da Plaid. (Le transazioni scaricate resteranno)')) {
        return;
    }

    if (btn) {
        btn.disabled = true;
        const originalContent = btn.innerHTML;
        btn.innerHTML = '<div class="spinner-wheel-small" style="display:inline-block; margin-right: 8px;"></div> Rimozione...';
        
        try {
            const token = getAuthToken();
            const response = await fetch(`/api/bank/connections/${connectionId}`, {
                method: 'DELETE',
                headers: { 'Authorization': `Bearer ${token}` }
            });
            
            const result = await response.json();
            if (result.success) {
                showMessage(`✅ Banca scollegata.`, 'success');
                loadBankAccounts();
            } else {
                showMessage(result.error, 'error');
                btn.disabled = false;
                btn.innerHTML = originalContent;
            }
        } catch (error) {
            showMessage('Errore di connessione durante la rimozione', 'error');
            btn.disabled = false;
            btn.innerHTML = originalContent;
        }
    }
}

/**
 * Attiva/Disattiva la visibilità di un conto nel budget globale
 */
async function toggleAccountVisibility(accountId, btn) {
    if (btn) {
        btn.disabled = true;
        // ✅ FIX: Selettore robusto per trovare l'icona anche dopo la trasformazione Lucide (i -> svg)
        const icon = btn.querySelector('[data-lucide]');
        const originalLucide = icon ? icon.getAttribute('data-lucide') : 'eye';
        const willEnable = originalLucide === 'eye-off';
        
        try {
            const token = getAuthToken();
            
            if (willEnable) {
                const choice = await openSyncConfirmModal();
                if (choice === 'cancel') {
                    btn.disabled = false;
                    return;
                }
                
                await fetch(`/api/bank/accounts/${accountId}/toggle`, {
                    method: 'PATCH',
                    headers: { 'Authorization': `Bearer ${token}` }
                });
                
                if (choice === 'sync') {
                    await syncAccount(accountId, null);
                } else {
                    showMessage('✅ Conto abilitato in stato "Pronto"', 'success');
                }
            } else {
                await fetch(`/api/bank/accounts/${accountId}/toggle`, {
                    method: 'PATCH',
                    headers: { 'Authorization': `Bearer ${token}` }
                });
                showMessage('✅ Conto nascosto', 'success');

                // ✅ Se il conto che stiamo nascondendo era quello attualmente visualizzato,
                // resettiamo la visualizzazione a "Globale" per forzare la Piazza Pulita
                if (typeof window.getLastBankAccountId === 'function' && window.getLastBankAccountId() === accountId) {
                    if (typeof window.setLastBankAccountId === 'function') window.setLastBankAccountId(null);
                }
            }

            await loadBankAccounts();
            if (typeof window.updateStatsFromAPI === 'function') await window.updateStatsFromAPI();
            if (typeof window.updateTransactionsFromAPI === 'function') await window.updateTransactionsFromAPI();
            if (typeof window.loadAnalysisData === 'function') await window.loadAnalysisData();
            if (typeof window.drawPieChart === 'function') window.drawPieChart();

        } catch (error) {
            console.error('Errore toggle:', error);
            showMessage('Errore durante la modifica della visibilità', 'error');
        } finally {
            btn.disabled = false;
        }
    }
}

let syncModalResolver = null;

async function openSyncConfirmModal() {
    return new Promise((resolve) => {
        syncModalResolver = resolve;
        const modal = document.getElementById('syncConfirmModal');
        modal.style.display = 'flex'; // ✅ Fix: Usa flex per il centraggio CSS
        
        // Rinfresca icone Lucide all'interno del modal
        if (typeof lucide !== 'undefined') lucide.createIcons();
        
        document.getElementById('syncConfirmYes').onclick = () => {
            modal.style.display = 'none';
            resolve('sync');
        };
        document.getElementById('syncConfirmNo').onclick = () => {
            modal.style.display = 'none';
            resolve('ready');
        };
    });
}

function closeSyncModal() {
    const modal = document.getElementById('syncConfirmModal');
    modal.style.display = 'none';
    if (syncModalResolver) {
        syncModalResolver('cancel');
        syncModalResolver = null;
    }
}

window.addEventListener('click', (event) => {
    const modal = document.getElementById('syncConfirmModal');
    if (event.target === modal) closeSyncModal();
});

async function syncAllConnectedAccounts(btn) {
    if (btn) {
        btn.disabled = true;
        const originalContent = btn.innerHTML;
        btn.innerHTML = '<div class="spinner-wheel-small" style="display:inline-block; margin-right: 8px;"></div> Aggiornamento...';
        
        try {
            const token = getAuthToken();
            const response = await fetch('/api/bank/accounts', {
                headers: { 'Authorization': `Bearer ${token}` }
            });
            const data = await response.json();
            
            if (data.success) {
                const connectedAccounts = data.data.filter(a => a.isEnabled && a.isConnected);
                const syncPromises = connectedAccounts.map(acc => 
                    fetch(`/api/bank/sync/${acc.id}`, {
                        method: 'POST',
                        headers: { 'Authorization': `Bearer ${token}` }
                    })
                );
                
                await Promise.all(syncPromises);
                showMessage(`✅ ${connectedAccounts.length} conti aggiornati con successo!`, 'success');

                // Reset filtri: usciamo dalla "Modalità PDF" e mostriamo tutto il budget bancario
                if (typeof window.setLastUploadedFileId === 'function') window.setLastUploadedFileId(null);
                if (typeof window.setLastBankAccountId === 'function') window.setLastBankAccountId(null);
                if (typeof window.setLastFileDateRange === 'function') window.setLastFileDateRange(null);

                await loadBankAccounts();
                if (typeof window.updateStatsFromAPI === 'function') await window.updateStatsFromAPI();
                if (typeof window.updateTransactionsFromAPI === 'function') await window.updateTransactionsFromAPI();
                if (typeof window.loadAnalysisData === 'function') await window.loadAnalysisData();
            }
        } catch (error) {
            showMessage('Errore durante l\'aggiornamento globale', 'error');
        } finally {
            btn.disabled = false;
            btn.innerHTML = originalContent;
            if (typeof lucide !== 'undefined') lucide.createIcons();
        }
    }
}

/**
 * Sincronizzazione
 */
async function syncAccount(accountId, btn) {
    let originalContent = '';
    if (btn) {
        btn.disabled = true;
        originalContent = btn.innerHTML;
        btn.innerHTML = '<div class="spinner-wheel-small" style="display:inline-block; margin-right: 8px;"></div> Sync in corso...';
    }
    
    try {
        const token = getAuthToken();
        const response = await fetch(`/api/bank/sync/${accountId}`, {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${token}` }
        });
        
        const result = await response.json();
        if (result.success) {
            if (result.isWaiting || result.isProcessing) {
                // ⏳ Plaid non ha ancora i dati: mostra avviso, non aggiornare i grafici
                showMessage(`⏳ ${result.message}`, 'warning');
                if (btn) { btn.innerHTML = originalContent; btn.disabled = false; }
                await loadBankAccounts(); // aggiorna solo il lastSync sulla card
                return;
            }

            showMessage(`✅ ${result.message}`, 'success');
            
            // ✅ Reset dello stato di visualizzazione manuale (Usciamo dalla "Modalità PDF")
            if (typeof window.setLastUploadedFileId === 'function') window.setLastUploadedFileId(null);
            if (typeof window.setLastBankAccountId === 'function') window.setLastBankAccountId(accountId);
            if (typeof window.setLastFileDateRange === 'function') window.setLastFileDateRange(null);

            await loadBankAccounts();
            if (typeof window.updateStatsFromAPI === 'function') await window.updateStatsFromAPI();
            if (typeof window.updateTransactionsFromAPI === 'function') await window.updateTransactionsFromAPI();
            if (typeof window.loadAnalysisData === 'function') await window.loadAnalysisData();
            if (typeof window.drawPieChart === 'function') window.drawPieChart();
        } else if (result.requiresUpdate) {
            if (!window.accountsRequiringUpdate) window.accountsRequiringUpdate = new Set();
            window.accountsRequiringUpdate.add(accountId);
            try { localStorage.setItem('accountsRequiringUpdate', JSON.stringify([...window.accountsRequiringUpdate])); } catch {}
            await loadBankAccounts();
            showMessage('Attenzione: la banca richiede una nuova autenticazione. Clicca "Risolvi Errore".', 'warning');
        } else {
            showMessage(result.error || 'Errore sincronizzazione', 'error');
        }
    } catch (error) {
        console.error('Errore sync:', error);
        showMessage('Errore durante la sincronizzazione', 'error');
    } finally {
        if (btn) {
            btn.disabled = false;
            btn.innerHTML = originalContent;
            if (typeof lucide !== 'undefined') lucide.createIcons();
        }
    }
}

/**
 * Avvia la Plaid Update Mode per risolvere i reset MFA della banca
 */
async function startUpdateMode(accountId) {
    try {
        const token = getAuthToken();
        const response = await fetch(`/api/bank/create-update-link-token/${accountId}`, {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${token}` }
        });
        const data = await response.json();
        
        if (!data.success) {
            showMessage(data.error || 'Errore inizializzazione aggiornamento Plaid', 'error');
            return;
        }

        const handler = Plaid.create({
            token: data.link_token,
            onSuccess: async (public_token, metadata) => {
                showMessage('✅ Connessione con la banca rinnovata con successo!', 'success');
                if (window.accountsRequiringUpdate) {
                    window.accountsRequiringUpdate.delete(accountId);
                    try { localStorage.setItem('accountsRequiringUpdate', JSON.stringify([...window.accountsRequiringUpdate])); } catch {}
                }
                // Forza immediatamente la sincronizzazione dei dati
                await loadBankAccounts();
                await syncAccount(accountId, null);
            },
            onLoad: () => {},
            onExit: (err, metadata) => {
                if (err != null) {
                    console.error('Errore Plaid Update:', err);
                    showMessage('Procedura di sblocco banca interrotta o non riuscita', 'error');
                }
            },
            onEvent: (eventName, metadata) => {}
        });

        handler.open();
    } catch (error) {
         console.error('Errore avvio update mode:', error);
         showMessage('Errore di connessione a Plaid', 'error');
    }
}


/**
 * Aggiorna solo il saldo in tempo reale (Prodotto Balance)
 */
async function refreshAccountBalance(accountId, btn) {
    if (btn) {
        btn.disabled = true;
        const icon = btn.querySelector('svg');
        if (icon) icon.style.animation = 'spin 1s linear infinite';
    }

    try {
        const token = getAuthToken();
        const response = await fetch(`/api/bank/balance/${accountId}`, {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${token}` }
        });

        const result = await response.json();
        if (result.success) {
            const balanceEl = document.getElementById(`balance-${accountId}`);
            if (balanceEl) {
                balanceEl.innerHTML = `€ ${parseFloat(result.balance).toFixed(2)}`;
                balanceEl.classList.add('flash-success');
                setTimeout(() => balanceEl.classList.remove('flash-success'), 1000);
            }
            showMessage(`✅ ${result.message}`, 'success');
        } else {
            showMessage(result.error || 'Errore aggiornamento saldo', 'error');
        }
    } catch (error) {
        console.error('Errore refresh saldo:', error);
        showMessage('Errore durante l\'aggiornamento del saldo', 'error');
    } finally {
        if (btn) {
            btn.disabled = false;
            const icon = btn.querySelector('svg');
            if (icon) icon.style.animation = '';
        }
    }
}

// Intercetta il cambio tab per caricare le banche
const originalSwitchTab = window.switchTab;
window.switchTab = function(tabName) {
    if (typeof originalSwitchTab === 'function') originalSwitchTab(tabName);
    if (tabName === 'bank') {
        loadBankAccounts();
    }
};
