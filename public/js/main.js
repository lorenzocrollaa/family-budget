        var API_BASE = '';
        var userEmail = 'demo@famiglia.it';

        function refreshIcons() { if (typeof lucide !== 'undefined') lucide.createIcons(); }
        var currentUser = null;
        var appData = {
            transactions: [],
            categories: {},
            travels: []
        };
        var currentTravelId = null;
        var currentDateFilter = null;
        let _balAnimFrame = null;
        let _balCurrent = 0;
        function animateBalance(target) {
            if (_balAnimFrame) cancelAnimationFrame(_balAnimFrame);
            const el = document.getElementById('totalBalance');
            if (!el) return;
            const start = _balCurrent;
            const diff = target - start;
            const dur = 700;
            const t0 = performance.now();
            function step(now) {
                const p = Math.min((now - t0) / dur, 1);
                const ease = 1 - Math.pow(1 - p, 3);
                _balCurrent = start + diff * ease;
                el.textContent = formatAmount(_balCurrent);
                if (p < 1) _balAnimFrame = requestAnimationFrame(step);
                else { _balCurrent = target; el.textContent = formatAmount(target); }
            }
            _balAnimFrame = requestAnimationFrame(step);
        }
        var currentVerifyTransaction = null;
        var pieChartSlices = [];
        let chartInstance = null;
        var showAllTransactions = false;
        var lastUploadedFileId = null;
        var lastUploadedFileName = null;
        var lastBankAccountId = null; 
        var lastFileDateRange = null; 
        
        // Esposizione per l'accesso da altri script
        window.setLastUploadedFileId = (val) => { lastUploadedFileId = val; };
        window.setLastBankAccountId = (val) => { lastBankAccountId = val; };
        window.getLastUploadedFileId = () => lastUploadedFileId;
        window.getLastBankAccountId = () => lastBankAccountId;
        window.setLastFileDateRange = (val) => { lastFileDateRange = val; };
        
        // --- HELPER FORMATTAZIONE ---
        function formatAmount(amount, forceSign = false) {
            const formatted = new Intl.NumberFormat('it-IT', {
                minimumFractionDigits: 2,
                maximumFractionDigits: 2
            }).format(Math.abs(amount));
            
            let sign = '';
            if (forceSign) {
                sign = amount >= 0 ? '+ ' : '- ';
            } else if (amount < 0) {
                sign = '- ';
            }
            
            return `${sign}${formatted} €`;
        }
        window.formatAmount = formatAmount;

        // --- THEME MANAGEMENT ---
        function setTheme(theme, save = true) {
            document.documentElement.setAttribute('data-theme', theme);
            if (save) localStorage.setItem('theme_preference', theme);
            // Sync toggle switch
            const sw = document.getElementById('themeSwitchInput');
            if (sw) sw.checked = (theme === 'dark');
            updateChartThemes();
        }
        window.setTheme = setTheme;

        function toggleTheme() {
            const current = document.documentElement.getAttribute('data-theme') || 'dark';
            setTheme(current === 'dark' ? 'light' : 'dark');
        }
        window.toggleTheme = toggleTheme;

        function onThemeSwitchChange(el) { setTheme(el.checked ? 'dark' : 'light'); }
        window.onThemeSwitchChange = onThemeSwitchChange;

        function toggleMiniProfile(event) {
            if (event) event.stopPropagation();
            const panel = document.getElementById('miniProfilePanel');
            if (!panel) return;
            panel.classList.toggle('open');
            if (panel.classList.contains('open')) {
                const close = (e) => {
                    if (!document.getElementById('miniProfile').contains(e.target)) {
                        panel.classList.remove('open');
                        document.removeEventListener('click', close);
                    }
                };
                setTimeout(() => document.addEventListener('click', close), 10);
            }
        }
        window.toggleMiniProfile = toggleMiniProfile;

        function initTheme() {
            const saved = localStorage.getItem('theme_preference');
            if (saved) {
                setTheme(saved, false);
            } else {
                const hour = new Date().getHours();
                const isNight = hour < 7 || hour >= 21;
                setTheme(isNight ? 'dark' : 'light', false);
            }
        }

        function updateChartThemes() {
            if (typeof Chart === 'undefined') return;
            const style = getComputedStyle(document.documentElement);
            const textColor = style.getPropertyValue('--text-muted').trim() || '#94a3b8';
            const bgCard = style.getPropertyValue('--bg-card').trim() || '#1c1f2e';
            const borderGlass = style.getPropertyValue('--border-glass-light').trim() || 'rgba(255,255,255,0.1)';
            
            Chart.defaults.color = isDarkMode() ? '#94a3b8' : '#1e293b';
            
            // Refresh main chart (pie chart) if active
            const mainChart = window.chartInstance || (typeof chartInstance !== 'undefined' ? chartInstance : null);
            if (mainChart) {
                const colors = isDarkMode() ? 
                    { border: '#11131c', tooltipBg: 'rgba(15, 17, 26, 0.95)', tooltipBorder: 'rgba(255,255,255,0.1)' } : 
                    { border: '#ffffff', tooltipBg: 'rgba(255, 255, 255, 0.98)', tooltipBorder: 'rgba(0,0,0,0.1)' };

                mainChart.options.plugins.tooltip.backgroundColor = colors.tooltipBg;
                mainChart.options.plugins.tooltip.borderColor = colors.tooltipBorder;
                mainChart.options.plugins.tooltip.titleColor = isDarkMode() ? '#fff' : '#000';
                mainChart.options.plugins.tooltip.bodyColor = isDarkMode() ? '#fff' : '#000';
                
                if (mainChart.data.datasets && mainChart.data.datasets[0]) {
                    mainChart.data.datasets[0].borderColor = colors.border;
                    mainChart.data.datasets[0].borderWidth = isDarkMode() ? 1 : 4;
                }
                mainChart.update('none');
            }

            // Refresh Analysis Overview Chart
            if (typeof analysisOverviewChartInst !== 'undefined' && analysisOverviewChartInst) {
                const gridColor = isDarkMode() ? 'rgba(255,255,255,0.04)' : 'rgba(15, 23, 42, 0.1)';
                const tooltipBg = isDarkMode() ? 'rgba(12,14,22,0.95)' : 'rgba(255,255,255,0.95)';
                
                analysisOverviewChartInst.options.scales.x.grid.color = gridColor;
                analysisOverviewChartInst.options.scales.y.grid.color = gridColor;
                analysisOverviewChartInst.options.scales.x.ticks.color = Chart.defaults.color;
                analysisOverviewChartInst.options.scales.y.ticks.color = Chart.defaults.color;
                analysisOverviewChartInst.options.plugins.tooltip.backgroundColor = tooltipBg;
                analysisOverviewChartInst.update('none');
            }

            // Refresh Analysis Category Chart
            if (typeof analysisCategoryChartInst !== 'undefined' && analysisCategoryChartInst) {
                const gridColor = isDarkMode() ? 'rgba(255,255,255,0.04)' : 'rgba(15, 23, 42, 0.1)';
                analysisCategoryChartInst.options.scales.y.grid.color = gridColor;
                analysisCategoryChartInst.options.scales.y.ticks.color = Chart.defaults.color;
                analysisCategoryChartInst.options.scales.x.ticks.color = Chart.defaults.color;
                analysisCategoryChartInst.update('none');
            }
        }
        window.initTheme = initTheme;
        
        // Modalità Bulk Edit
        window.selectedTransactions = new Set();
        window.isBulkEditMode = false;

        function isDarkMode() {
            return document.documentElement.getAttribute('data-theme') !== 'light';
        }

        function showMessage(text, type) {
            var messageEl = document.getElementById('message');
            
            // 🔥 Map notification types to modern Lucide icons
            const iconMap = {
                'success': 'check-circle-2',
                'error': 'alert-circle',
                'warning': 'alert-triangle',
                'info': 'info'
            };
            const iconName = iconMap[type] || 'bell';
            
            messageEl.innerHTML = `<i data-lucide="${iconName}" style="width: 20px; height: 20px; flex-shrink: 0;"></i> <span style="white-space: pre-line; display: block;">${text}</span>`;
            messageEl.className = 'message ' + type;
            messageEl.style.display = 'flex';
            messageEl.style.alignItems = 'flex-start';
            messageEl.style.gap = '12px';
            messageEl.style.minWidth = '300px';
            messageEl.style.padding = '15px';
            messageEl.style.zIndex = '9999';
            
            // Re-render icons since we injected HTML
            if (typeof lucide !== 'undefined') {
                lucide.createIcons();
            }

            const duration = text.length > 60 ? 10000 : 5000;
            setTimeout(function() {
                messageEl.style.opacity = '0';
                messageEl.style.transform = 'translateY(-10px)';
                setTimeout(() => {
                    messageEl.style.display = 'none';
                    messageEl.style.opacity = '1';
                    messageEl.style.transform = 'none';
                }, 300);
            }, duration);
        }

        function getAuthToken() {
            return localStorage.getItem('authToken');
        }

        function setAuthToken(token) {
            localStorage.setItem('authToken', token);
        }

        let authResolve = null;

        async function ensureAuthenticated() {
            let token = getAuthToken();
            
            // Se esiste un token, proviamo a recuperare il profilo utente per assicurarci che sia valido
            if (token) {
                if (!currentUser) {
                    try {
                        const response = await fetch('/api/auth/profile', {
                            headers: { 'Authorization': `Bearer ${token}` }
                        });
                        if (response.ok) {
                            const result = await response.json();
                            currentUser = result.user;
                            updateUserDisplay();
                            return token; // Token valido e utente caricato
                        } else {
                            // Token non valido o scaduto
                            localStorage.removeItem('authToken');
                            token = null; 
                        }
                    } catch (e) {
                        console.error("Errore validazione token:", e);
                        localStorage.removeItem('authToken');
                        token = null;
                    }
                } else {
                    return token; // Token e utente già presenti in memoria
                }
            }

            // Se arriviamo qui, l'utente DEVE fare login
            console.log('🔐 Utente non autenticato. Mostro blocco login...');
            document.getElementById('authScreen').style.display = 'flex';
            document.getElementById('appContainer').style.display = 'none';
            document.getElementById('appTabBar').style.display = 'none';

            // Restituisce una Promise che si risolverà solo al termine del login
            return new Promise((resolve) => {
                authResolve = resolve;
            });
        }

        function switchAuthTab(tab) {
            const isLogin = tab === 'login';
            document.getElementById('tabLoginBtn').classList.toggle('on', isLogin);
            document.getElementById('tabRegisterBtn').classList.toggle('on', !isLogin);
            document.getElementById('authLoginForm').style.display = isLogin ? 'block' : 'none';
            document.getElementById('authRegisterForm').style.display = isLogin ? 'none' : 'block';
            refreshIcons();
        }

        async function handleLogin() {
            const email = document.getElementById('loginEmail').value;
            const password = document.getElementById('loginPassword').value;
            
            if(!email || !password) {
                showMessage('Inserisci email e password', 'warning');
                return;
            }
            
            try {
                const response = await fetch('/api/auth/login', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ email, password })
                });
                
                const result = await response.json();
                if(response.ok && result.success) {
                    setAuthToken(result.token);
                    currentUser = result.user;
                    finishAuthentication();
                    showMessage('Accesso effettuato con successo!', 'success');
                } else {
                    showMessage(result.error || 'Credenziali non valide', 'error');
                }
            } catch(e) {
                showMessage('Errore di connessione', 'error');
            }
        }
        
        async function handleRegister() {
            const name = document.getElementById('registerName').value;
            const email = document.getElementById('registerEmail').value;
            const password = document.getElementById('registerPassword').value;
            
            if(!name || !email || !password) {
                showMessage('Tutti i campi sono obbligatori', 'warning');
                return;
            }
            
            try {
                const response = await fetch('/api/auth/register', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ email, name, password })
                });
                
                const result = await response.json();
                if(response.ok && result.success) {
                    setAuthToken(result.token);
                    currentUser = result.user;
                    finishAuthentication();
                    showMessage('Benvenuto in Family Budget!', 'success');
                } else {
                    showMessage(result.error || 'Errore durante la registrazione', 'error');
                }
            } catch(e) {
                showMessage('Errore di connessione', 'error');
            }
        }

        async function finishAuthentication() {
            updateUserDisplay();
            document.dispatchEvent(new CustomEvent('userLoaded', { detail: currentUser }));
            document.getElementById('authScreen').style.display = 'none';
            document.getElementById('appContainer').style.display = 'block';
            document.getElementById('appTabBar').style.display = 'flex';
            document.getElementById('miniProfile').style.display = 'block';

            if(authResolve) {
                const token = getAuthToken();
                authResolve(token);
                authResolve = null;
            } else {
                // Riavvia il caricamento dei dati se non eravamo in attesa di un API Call bloccata
                await initializeApplicationData();
            }
            
            setTimeout(() => { if (typeof lucide !== 'undefined') lucide.createIcons(); }, 100);
        }

        function handleLogout() {
            stopCoinBursts();
            document.getElementById('miniProfilePanel')?.classList.remove('open');
            document.getElementById('miniProfile').style.display = 'none';
            localStorage.removeItem('authToken');
            currentUser = null;
            window.location.reload();
        }

        function updateUserDisplay() {
            if (currentUser) {
                if (currentUser.name) {
                    const nameEl = document.getElementById('userDisplayName');
                    if (nameEl) nameEl.textContent = currentUser.name;
                }
                const avatarSrc = currentUser.avatar
                    ? (currentUser.avatar.startsWith('/') ? currentUser.avatar : `img/avatars/${currentUser.avatar}.png`)
                    : 'img/avatars/default.png';
                const btn = document.getElementById('userAvatarImg');
                const panel = document.getElementById('userAvatarImgPanel');
                if (btn) btn.src = avatarSrc;
                if (panel) panel.src = avatarSrc;

                // Badge piano
                const badgeEl = document.getElementById('planBadge');
                if (badgeEl) {
                    if (currentUser.plan === 'pro') {
                        badgeEl.textContent = 'PRO';
                        badgeEl.className = 'plan-badge plan-pro';
                        badgeEl.onclick = () => openBillingPortal();
                    } else {
                        badgeEl.textContent = 'FREE';
                        badgeEl.className = 'plan-badge plan-free';
                        badgeEl.onclick = () => startUpgrade();
                    }
                }
            }
        }

        async function startUpgrade() {
            try {
                const data = await apiCall('/stripe/checkout', { method: 'POST' });
                if (data.url) window.location.href = data.url;
            } catch (e) {
                alert('Errore durante il checkout. Riprova.');
            }
        }

        async function openBillingPortal() {
            try {
                const data = await apiCall('/stripe/portal', { method: 'POST' });
                if (data.url) window.open(data.url, '_blank');
            } catch (e) {
                alert('Errore durante l\'apertura del portale.');
            }
        }

        async function apiCall(endpoint, options = {}) {
            const token = await ensureAuthenticated();
            const defaultOptions = {
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'Content-Type': 'application/json',
                    ...options.headers
                }
            };

            const response = await fetch(API_BASE + endpoint, {
                ...defaultOptions,
                ...options
            });

            if (!response.ok) {
                if (response.status === 401 || response.status === 403) {
                    localStorage.removeItem('authToken');
                    return apiCall(endpoint, options);
                }
                const errorData = await response.text();
                throw new Error(`API Error ${response.status}: ${errorData}`);
            }

            return await response.json();
        }

        function selectFile() {
            document.getElementById('fileInput').click();
        }

        // --- INIZIO DRAG & DROP LOGIC ---
        document.addEventListener('DOMContentLoaded', () => {
            // Inizializza Tema
            initTheme();
            
            const dropzone = document.getElementById('dropzone');
            const fileInput = document.getElementById('fileInput');

            if (dropzone && fileInput) {
                // Previene il comportamento default (apertura file)
                ['dragenter', 'dragover', 'dragleave', 'drop'].forEach(eventName => {
                    dropzone.addEventListener(eventName, preventDefaults, false);
                });

                function preventDefaults(e) {
                    e.preventDefault();
                    e.stopPropagation();
                }

                // Evidenzia la dropzone
                ['dragenter', 'dragover'].forEach(eventName => {
                    dropzone.addEventListener(eventName, () => dropzone.classList.add('dragover'), false);
                });

                // Rimuove l'evidenziazione
                ['dragleave', 'drop'].forEach(eventName => {
                    dropzone.addEventListener(eventName, () => dropzone.classList.remove('dragover'), false);
                });

                // Gestisce il drop
                dropzone.addEventListener('drop', (e) => {
                    let dt = e.dataTransfer;
                    let files = dt.files;
                    handleFileUpload(files);
                }, false);

                // Gestisce l'input file standard
                fileInput.addEventListener('change', function() {
                    handleFileUpload(this.files);
                });
            }
        });
        // --- FINE DRAG & DROP LOGIC ---
        let isUploading = false;
        async function handleFileUpload(files) {
            if (isUploading) {
                console.warn('⚠️ Upload già in corso, ignoro la richiesta duplicata.');
                return;
            }
            
            console.log('🚀 Avvio upload REALE con backend API - File:', files.length);

            if (!files || files.length === 0) {
                showMessage('Seleziona almeno un file', 'error');
                return;
            }

            isUploading = true;
            const container = document.getElementById('uploadedFiles');
            const dropzone = document.getElementById('dropzone');
            const skeleton = document.getElementById('uploadSkeleton');

            // Nascondi la dropzone e mostra gli skeleton loader
            dropzone.style.display = 'none';
            skeleton.style.display = 'flex';
            container.innerHTML = ''; // Svuota errori precedenti
            
            // 🔥 Quando carichi un file, disattiva il filtro Banca per tornare in "Modalità PDF"
            lastBankAccountId = null;
            lastUploadedFileId = null;

            try {
                const token = await ensureAuthenticated();
                const formData = new FormData();
                
                for (let i = 0; i < files.length; i++) {
                    formData.append('files', files[i]);
                }
                
                const uploadAsMemory = document.getElementById('uploadAsMemory');
                if (uploadAsMemory && uploadAsMemory.checked) {
                    formData.append('isMemory', 'true');
                }

                const startTime = Date.now();
                let response = await fetch('/api/transactions/upload', {
                    method: 'POST',
                    headers: { 'Authorization': `Bearer ${token}` },
                    body: formData
                });

                // Auto-Recovery per l'upload
                if (response.status === 401 || response.status === 403) {
                    console.log('🔄 Token scaduto durante upload, provo a rigenerarlo e riprovo...');
                    localStorage.removeItem('authToken');
                    const newToken = await ensureAuthenticated();
                    response = await fetch('/api/transactions/upload', {
                        method: 'POST',
                        headers: { 'Authorization': `Bearer ${newToken}` },
                        body: formData
                    });
                }

                const uploadTime = ((Date.now() - startTime) / 1000).toLocaleString('it-IT', { minimumFractionDigits: 2 });

                if (!response.ok) {
                    const errorData = await response.json();
                    throw new Error(errorData.error || `Upload fallito: ${response.statusText}`);
                }

                const result = await response.json();
                console.log('✅ Risultato upload API:', result);
                console.log('📊 Processed files:', result.data?.processedFiles);
                console.log('📈 Total transactions:', result.data?.totalTransactions);

                if (result.success) {
                    // 📌 Usa l'ID del file dalla risposta dell'upload
                    const { processedFiles, totalTransactions, successfulFiles } = result.data;
                    
                    console.log('🔍 Dettaglio files processati:', processedFiles);
                    
                    if (processedFiles && processedFiles.length > 0) {
                        // Prendi l'ultimo file caricato con successo
                        const successfulFile = processedFiles.find(f => f.success && f.fileId);
                        
                        if (successfulFile) {
                            lastUploadedFileId = successfulFile.fileId;
                            lastUploadedFileName = successfulFile.fileName;
                            lastFileDateRange = successfulFile.dateRange; // ✅ Memorizza per reset futuro
                            console.log('✅ File caricato:', lastUploadedFileName, '(ID:', lastUploadedFileId, ')');
                            console.log('📊 Transazioni nel file:', successfulFile.transactionCount);
                            
                            // 🆕 Auto-update the Date Filters to the File boundaries (RESTORED)
                            if (successfulFile.dateRange) {
                                const dates = successfulFile.dateRange.split(' to ');
                                if (dates.length === 2 && dates[0] && dates[1]) {
                                    document.getElementById('dateFrom').value = dates[0].trim();
                                    document.getElementById('dateTo').value = dates[1].trim();
                                    console.log('📅 Date Filters Auto-Updated:', dates[0], 'to', dates[1]);
                                    
                                    currentDateFilter = {
                                        from: dates[0].trim(),
                                        to: dates[1].trim()
                                    };
                                }
                            }
                            
                            document.getElementById('transactionsTitle').textContent = 'Transazioni File Corrente';
                        } else {
                            console.error('❌ Nessun file con successo trovato nella risposta');
                        }
                    }
                    
                    // Skip summary display as requested, go straight to Home
                    await updateStatsFromAPI();
                    await updateTransactionsFromAPI();
                    showDateFilter();
                    
                    const successMsg = `✅ ${successfulFiles}/${processedFiles.length} file processati con successo!`;
                    showMessage(successMsg, 'success');
                    showMessage(`Sono state aggiunte ${totalTransactions} nuove transazioni.`, 'success');
                    
                    // Switch to home after a very brief delay to let notifications appear
                    setTimeout(() => { 
                        switchTab('home'); 
                    }, 500);
                } else {
                    throw new Error(result.error || 'Upload fallito');
                }

            } catch (error) {
                console.error('❌ Errore upload:', error);
                showMessage(`Errore upload: ${error.message}`, 'error');
                container.innerHTML = `
                    <div class="card" style="border: 2px solid #f43f5e;">
                        <h4 style="color: #f43f5e; margin-bottom: 15px; display:flex; align-items:center; gap:8px; justify-content:center;"><i data-lucide="x-circle"></i> Upload Fallito</h4>
                        <div style="background: rgba(248, 113, 113, 0.1); padding: 15px; border-radius: 10px;">
                            <strong>Errore:</strong> ${error.message}
                        </div>
                        <button class="btn" onclick="selectFile()" style="margin-top: 15px;">
                            <i data-lucide="refresh-ccw"></i> Riprova con un altro file
                        </button>
                    </div>
                `;
            } finally {
                // Ripristina UI Nascondendo lo skeleton
                document.getElementById('uploadSkeleton').style.display = 'none';
                document.getElementById('dropzone').style.display = '';
                isUploading = false;
            }

            document.getElementById('fileInput').value = '';
        }

        function displayProcessedFilesEnhanced(uploadData, uploadTime) {
            const container = document.getElementById('uploadedFiles');
            const { processedFiles, totalTransactions, successfulFiles } = uploadData;
            container.innerHTML = `<div class="card"><h4 style="margin-bottom: 20px; display:flex; align-items:center; gap:8px;"><i data-lucide="bar-chart-2"></i> Risultati Parsing</h4>`;
            
            processedFiles.forEach(fileResult => {
                const statusIcon = fileResult.success ? '<i data-lucide="check-circle-2" style="color:var(--accent-success);width:16px;height:16px;"></i>' : '<i data-lucide="x-circle" style="color:var(--accent-danger);width:16px;height:16px;"></i>';
                const statusColor = fileResult.success ? 'var(--accent-success)' : '#f43f5e';
                const bgColor = fileResult.success ? 'rgba(74, 222, 128, 0.1)' : 'rgba(248, 113, 113, 0.1)';
                const fileDiv = document.createElement('div');
                fileDiv.style = `background: ${bgColor}; border: 1px solid ${statusColor}; border-radius: 12px; padding: 15px; margin-bottom: 15px;`;
                
                let detailsHTML = fileResult.success ? `
                    <div style="font-size: 12px; opacity: 0.8; margin-top: 8px;">
                        <i data-lucide="calendar"></i> Periodo: ${fileResult.dateRange || 'N/A'}<br>
                        <i data-lucide="search"></i> Metodo: ${fileResult.method || 'Auto'}<br>
                        <i data-lucide="landmark"></i> Formato: ${fileResult.bankFormat || 'Generic'}<br>
                        <i data-lucide="bot"></i> Transazioni: ${fileResult.transactionCount} estratte e categorizzate con AI
                    </div>
                ` : `<div style="color: #f43f5e; font-size: 12px; margin-top: 8px;">⚠️ Errore: ${fileResult.error || 'Formato non riconosciuto'}</div>`;
                
                fileDiv.innerHTML = `
                    <div style="display: flex; justify-content: space-between; align-items: start;">
                        <div style="flex: 1;">
                            <div style="font-weight: bold; font-size: 16px;">${statusIcon} ${fileResult.fileName}</div>
                            ${detailsHTML}
                        </div>
                        <div style="font-weight: bold; font-size: 20px; color: ${statusColor};">${fileResult.transactionCount || 0}</div>
                    </div>
                `;
                container.appendChild(fileDiv);
            });
            
            const summaryDiv = document.createElement('div');
            summaryDiv.style = 'background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); padding: 20px; border-radius: 15px; margin-top: 20px; color: white; text-align: center;';
            summaryDiv.innerHTML = `
                <div style="font-size: 14px; opacity: 0.9; margin-bottom: 10px; display:flex; align-items:center; gap:8px; justify-content:center;"><i data-lucide="bar-chart-2"></i> RIEPILOGO UPLOAD</div>
                <div style="font-size: 32px; font-weight: bold; margin-bottom: 10px;">${totalTransactions}</div>
                <div style="font-size: 16px; margin-bottom: 15px;">Nuove Transazioni Aggiunte</div>
                <div style="display: grid; grid-template-columns: repeat(3, 1fr); gap: 15px; margin-top: 15px; padding-top: 15px; border-top: 1px solid rgba(255,255,255,0.3);">
                    <div><div style="font-size: 24px; font-weight: bold;">${successfulFiles}</div><div style="font-size: 12px; opacity: 0.9;">File OK</div></div>
                    <div><div style="font-size: 24px; font-weight: bold;">${processedFiles.length - successfulFiles}</div><div style="font-size: 12px; opacity: 0.9;">Errori</div></div>
                    <div><div style="font-size: 24px; font-weight: bold;">${uploadTime}s</div><div style="font-size: 12px; opacity: 0.9;">Tempo</div></div>
                </div>
                <div style="margin-top: 15px; padding-top: 15px; border-top: 1px solid rgba(255,255,255,0.3); font-size: 13px; opacity: 0.9;">
                    <i data-lucide="database"></i> I dati sono stati salvati nel database<br>
                    <i data-lucide="bot"></i> Il sistema ha imparato dai nuovi pattern<br>
                    <i data-lucide="refresh-ccw"></i> Puoi caricare altri file quando vuoi
                </div>
            `;
            container.appendChild(summaryDiv);
            
            const actionDiv = document.createElement('div');
            actionDiv.style = 'margin-top: 20px;';
            actionDiv.innerHTML = `
                <button class="btn" onclick="switchTab('home')" style="margin-bottom: 10px;"><i data-lucide="layout-dashboard"></i> Vai alla Dashboard</button>
                <button class="btn" onclick="clearUploadHistory()" style="background: rgba(255,255,255,0.1); color: white;"><i data-lucide="upload-cloud"></i> Carica Altri File</button>
            `;
            container.appendChild(actionDiv);
            container.innerHTML += '</div>';
        }

        function clearUploadHistory() {
            document.getElementById('uploadedFiles').innerHTML = '';
            document.getElementById('fileInput').value = '';
            showMessage('Pronto per nuovi caricamenti!', 'success');
        }

        async function updateStatsFromAPI() {
        window.updateStatsFromAPI = updateStatsFromAPI;

            console.log('Aggiornamento statistiche dal database...');
            
            // Se non c'è file caricato, mostriamo i totali del DB (non blocchiamo più)
            if (!lastUploadedFileId) {
                console.log('ℹ️ Nessun file caricato, mostro statistiche globali');
            }
            
            try {
                const params = new URLSearchParams();
                
                if (lastUploadedFileId) {
                    params.append('uploadedFileId', lastUploadedFileId);
                    console.log('📊 Stats filtrate per file ID:', lastUploadedFileId);
                } else if (lastBankAccountId) {
                    params.append('bankAccountId', lastBankAccountId);
                    console.log('🏦 Filtro attivo per conto bancario:', lastBankAccountId);
                }
                
                if (currentDateFilter) {
                    if (currentDateFilter.from) params.append('dateFrom', currentDateFilter.from);
                    if (currentDateFilter.to) params.append('dateTo', currentDateFilter.to);
                }

                // 🔥 Cache busting
                params.append('_t', Date.now());

                const result = await apiCall(`/api/transactions/stats?${params.toString()}`);
                console.log('Statistiche ricevute dal database:', result.data);
                const { summary, byCategory } = result.data;
                
                animateBalance(summary.balance);
                document.getElementById('totalIncomeDisplay').textContent = formatAmount(summary.income);
                document.getElementById('totalExpensesDisplay').textContent = formatAmount(summary.expenses);
                document.getElementById('totalTransactionsDisplay').textContent = summary.totalTransactions;

                // Update card color state
                const card = document.getElementById('balanceCard');
                if (card) {
                    card.classList.remove('bal-positive','bal-negative','bal-zero');
                    if (summary.balance > 0) card.classList.add('bal-positive');
                    else if (summary.balance < 0) card.classList.add('bal-negative');
                    else card.classList.add('bal-zero');
                }
                // Animate pig
                if (summary.balance > 0) setPigState('happy');
                else if (summary.balance < 0) setPigState('sad');
                else setPigState('neutral');

                const changeEl = document.getElementById('balanceChange');
                if (summary.balance > 0) {
                    changeEl.textContent = '↑ Saldo positivo';
                    changeEl.style.color = 'rgba(74,222,128,0.9)';
                } else if (summary.totalTransactions > 0) {
                    changeEl.textContent = `${summary.totalTransactions} transazioni caricate`;
                    changeEl.style.color = 'rgba(255,255,255,0.6)';
                } else {
                    changeEl.textContent = 'Carica estratti per vedere dati reali';
                    changeEl.style.color = 'rgba(255,255,255,0.4)';
                }

                appData.categories = {};
                byCategory.forEach(cat => {
                    if (!cat.isIncome) {
                        appData.categories[cat.category] = {
                            amount: cat.amount,
                            count: cat.count,
                            color: cat.color,
                            emoji: cat.emoji || `<i data-lucide="${getCategoryIcon(cat.category)}"></i>`
                        };
                    }
                });

                // ✅ Auto-refresh UI components if visible
                const activeTab = document.querySelector('.tab-content.active');
                if (activeTab && activeTab.id === 'categoriesTab') {
                    drawPieChart(); drawMiniCharts();
                }
                
                // If we are in analysis tab, it might need refresh too
                if (activeTab && activeTab.id === 'analysisTab' && typeof loadAnalysisData === 'function') {
                    loadAnalysisData();
                }

                await updateTransactionsFromAPI();
                updateCategoriesDisplay();
            } catch (error) {
                console.error('Errore aggiornamento statistiche:', error);
                showMessage('Errore nel caricamento delle statistiche', 'error');
            }
        }

        async function updateTransactionsFromAPI() {
        window.updateTransactionsFromAPI = updateTransactionsFromAPI;

            try {
                const params = new URLSearchParams();
                params.append('limit', '100000');

                if (lastUploadedFileId) {
                    params.append('uploadedFileId', lastUploadedFileId);
                    console.log('🎯 Filtro attivo per file ID:', lastUploadedFileId);
                } else if (lastBankAccountId) {
                    params.append('bankAccountId', lastBankAccountId);
                    console.log('🏦 Filtro attivo per conto bancario:', lastBankAccountId);
                }

                if (currentDateFilter) {
                    if (currentDateFilter.from) params.append('dateFrom', currentDateFilter.from);
                    if (currentDateFilter.to) params.append('dateTo', currentDateFilter.to);
                    console.log('📅 Applicando filtro data:', currentDateFilter);
                }

                // 🔥 Cache busting
                params.append('_t', Date.now());

                const result = await apiCall(`/api/transactions?${params.toString()}`);
                transactions = result.data.transactions || [];
                console.log(`📊 Transazioni caricate: ${transactions.length}`);

                if (lastUploadedFileId && !currentDateFilter) {
                    // document.getElementById('homeFileTxCount').textContent = transactions.length;
                }

                // ✅ Gestione visibilità tasto "Torna al Budget Reale"
                const exitBtn = document.getElementById('exitFileViewBtn');
                if (exitBtn) {
                    exitBtn.style.display = lastUploadedFileId ? 'flex' : 'none';
                    if (lastUploadedFileId && typeof lucide !== 'undefined') lucide.createIcons();
                }

                const container = document.getElementById('recentTransactions');
                
                if (transactions.length === 0) {
                    container.innerHTML = `
                        <div class="tab-empty-state" style="background:var(--bg-card);border-radius:var(--radius-lg);border:1px dashed var(--border-glass-light);">
                            <i data-lucide="layout-list" class="tab-empty-icon"></i>
                            <div class="tab-empty-title">Nessuna transazione trovata</div>
                            <div class="tab-empty-sub">Non ci sono transazioni corrispondenti ai criteri.</div>
                        </div>
                    `;
                    setTimeout(refreshIcons, 50);
                    return;
                }

                container.innerHTML = '';

                transactions.forEach(trans => {
                    const isIncome = trans.amount > 0;
                    const color = isIncome ? 'var(--accent-success)' : '#f43f5e';
                    const sign = isIncome ? '+' : '-';
                    const confidence = trans.confidence || 0;
                    let confidenceBadge = '', confidenceColor = 'var(--accent-success)', needsReview = false;
                    
                    if (confidence >= 0.8) {
                        confidenceBadge = '<span style="display:inline-flex;align-items:center;gap:4px;color:var(--accent-success);"><i data-lucide="check-circle-2" style="width:14px;height:14px;"></i> Alta</span>';
                        confidenceColor = 'var(--accent-success)';
                    } else if (confidence >= 0.5) {
                        confidenceBadge = '<span style="display:inline-flex;align-items:center;gap:4px;color:#facc15;"><i data-lucide="alert-triangle" style="width:14px;height:14px;"></i> Media</span>';
                        confidenceColor = '#feca57';
                        needsReview = true;
                    } else {
                        confidenceBadge = '<span style="display:inline-flex;align-items:center;gap:4px;color:var(--accent-danger);"><i data-lucide="help-circle" style="width:14px;height:14px;"></i> Bassa</span>';
                        confidenceColor = '#f43f5e';
                        needsReview = true;
                    }

                    const transDiv = document.createElement('div');
                    transDiv.className = `transaction-item-v2 ${!trans.isVerified && needsReview ? 'needs-review' : ''}`;
                    
                    if (!trans.isVerified && needsReview) {
                        transDiv.onclick = () => openVerifyModal(trans);
                        transDiv.title = 'Click per verificare la categoria';
                    }
                    
                    let badgeHTML = '';
                    if (!trans.isVerified) {
                        const badgeClass = confidence >= 0.8 ? 'high' : (confidence >= 0.5 ? 'med' : 'low');
                        const iconStatus = confidence >= 0.8 ? 'check-circle-2' : 'alert-circle';
                        badgeHTML = `<span class="tx-badge ${badgeClass}"><i data-lucide="${iconStatus}" style="width:12px; height:12px;"></i> AI ${(confidence * 100).toFixed(0)}%</span>`;
                    } else {
                        badgeHTML = `<span class="tx-badge verified"><i data-lucide="check-circle-2" style="width:12px; height:12px;"></i> Verificata</span>`;
                    }

                    const txColorClass = isIncome ? 'income' : 'expense';
                    const isSelected = window.selectedTransactions && window.selectedTransactions.has(trans.id);

                    transDiv.innerHTML = `
                        <div class="tx-checkbox-container" onclick="event.stopPropagation(); toggleSelection('${trans.id}', this.parentElement)">
                            <input type="checkbox" class="tx-checkbox" ${isSelected ? 'checked' : ''}>
                        </div>
                        <div class="tx-icon-circle">
                            <i data-lucide="${getCategoryIcon(trans.category)}" style="width:24px; height:24px;"></i>
                        </div>
                        <div class="tx-body">
                            <div class="tx-desc" title="Originale: ${trans.originalText || trans.description}">
                                ${trans.description}
                                ${trans.bankAccountId ? '<i data-lucide="landmark" style="width:12px; height:12px; display:inline; margin-left:4px; opacity:0.4;"></i>' : ''}
                            </div>
                            <div class="tx-meta">
                                <span><i data-lucide="calendar" style="width:12px; height:12px; display:inline-block; vertical-align:middle; margin-right:2px;"></i> ${trans.date}</span>
                                <span class="tx-badge cat-badge">${trans.category}</span>
                                ${badgeHTML}
                                ${trans.originalText && trans.originalText !== trans.description ? `<span style="font-size: 11px; opacity: 0.35; font-style: italic; display: block; margin-top: 2px;">🏦 ${trans.originalText}</span>` : ''}
                            </div>
                        </div>
                        <div class="tx-amount-col">
                            <div class="tx-amount ${txColorClass}">${formatAmount(trans.amount, isIncome)}</div>
                        </div>
                    `;
                    container.appendChild(transDiv);
                });

                console.log(`✅ Mostrate ${transactions.length} transazioni del file corrente`);
                setTimeout(refreshIcons, 50);
            } catch (error) {
                console.error('❌ Errore caricamento transazioni:', error);
                const container = document.getElementById('recentTransactions');
                container.innerHTML = `<div style="text-align: center; color: #f43f5e; padding: 20px;">❌ Errore caricamento transazioni</div>`;
            }
        }

        function openVerifyModal(transaction) {
            currentVerifyTransaction = transaction;
            window.isBulkEditMode = false;
            
            // ✅ Restore all single-transaction sections (in case bulk mode hid them)
            document.getElementById('verifyModalTitle').textContent = 'Verifica Categoria AI';
            document.getElementById('verifyTransactionInfoSection').style.display = 'block';
            document.getElementById('verifyCurrentCategorySection').style.display = 'block';
            document.getElementById('verifyActionButtons').style.display = 'flex';
            document.getElementById('categorySelectorDiv').style.display = 'none';

            document.getElementById('verifyTransactionDesc').textContent = transaction.description;
            document.getElementById('verifyTransactionDate').innerHTML = `<i data-lucide="calendar" style="width:13px;height:13px;"></i> ${transaction.date}`;
            document.getElementById('verifyTransactionAmount').textContent = formatAmount(transaction.amount, true);
            document.getElementById('verifyTransactionAmount').style.color = transaction.amount > 0 ? 'var(--accent-success)' : '#f43f5e';
            document.getElementById('verifyCurrentEmoji').innerHTML = `<i data-lucide="${getCategoryIcon(transaction.category)}" style="width:18px;height:18px;"></i>`;
            document.getElementById('verifyCurrentCategory').textContent = transaction.category;
            document.getElementById('verifyCurrentConfidence').textContent = `Confidence: ${(transaction.confidence * 100).toFixed(0)}%`;
            document.getElementById('verifyTransactionModal').style.display = 'block';
            setTimeout(refreshIcons, 50);
        }

        function closeVerifyModal() {
            document.getElementById('verifyTransactionModal').style.display = 'none';
            // ✅ Reset all section visibility for next open
            document.getElementById('verifyTransactionInfoSection').style.display = 'block';
            document.getElementById('verifyCurrentCategorySection').style.display = 'block';
            document.getElementById('verifyActionButtons').style.display = 'flex';
            document.getElementById('categorySelectorDiv').style.display = 'none';
            document.getElementById('verifyModalTitle').textContent = 'Verifica Categoria AI';
            currentVerifyTransaction = null;
            window.isBulkEditMode = false;
        }

        async function exitFileView() {
            console.log('🔙 Uscita da visualizzazione file, ritorno a Budget Reale');
            lastUploadedFileId = null;
            lastUploadedFileName = null;
            lastFileDateRange = null;
            
            // Reset titolo transazioni
            const titleEl = document.getElementById('transactionsTitle');
            if (titleEl) titleEl.textContent = 'Ultime Transazioni';
            
            // Nascondi tasto
            const exitBtn = document.getElementById('exitFileViewBtn');
            if (exitBtn) exitBtn.style.display = 'none';

            showMessage('Ritorno al Budget Reale...', 'info');
            
            // Rinfresca tutto con filtro ultimi 30 giorni
            if (typeof applyLast30DaysFilter === 'function') {
                await applyLast30DaysFilter();
            } else {
                await updateStatsFromAPI();
                await updateTransactionsFromAPI();
            }
            
            if (typeof loadAnalysisData === 'function') await loadAnalysisData();
            if (typeof window.drawPieChart === 'function') { window.drawPieChart(); drawMiniCharts(); }
        }
        window.exitFileView = exitFileView;

        async function confirmCategory() {
            if (!currentVerifyTransaction) return;
            try {
                // 🧠 Cerca altre transazioni con lo stesso nome merchant visibili
                const similarCount = await countSimilarTransactions(currentVerifyTransaction.description, currentVerifyTransaction.id);

                if (similarCount > 0) {
                    const applyAll = confirm(`Ci sono ${similarCount} altra/e transazioni di "${currentVerifyTransaction.description}".\n\nVuoi applicare "Verificata" anche a tutte queste? Clicca OK per applicare a tutte, Annulla per solo questa.`);
                    if (applyAll) {
                        showMessage('Applicando a tutte le transazioni...', 'info');
                        await apiCall(`/api/transactions/bulk-verify-by-description`, {
                            method: 'PUT',
                            body: JSON.stringify({
                                description: currentVerifyTransaction.description,
                                isVerified: true,
                                confidence: 1.0
                            })
                        });
                        showMessage(`Categoria confermata per tutte le transazioni di "${currentVerifyTransaction.description}"!`, 'success');
                    } else {
                        await apiCall(`/api/transactions/${currentVerifyTransaction.id}`, {
                            method: 'PUT',
                            body: JSON.stringify({ isVerified: true, confidence: 1.0 })
                        });
                        showMessage('Categoria confermata per questa transazione.', 'success');
                    }
                } else {
                    await apiCall(`/api/transactions/${currentVerifyTransaction.id}`, {
                        method: 'PUT',
                        body: JSON.stringify({ isVerified: true, confidence: 1.0 })
                    });
                    showMessage('Categoria confermata! Il sistema ha imparato.', 'success');
                }

                await updateTransactionsFromAPI();
                const activeTab = document.querySelector('.tab-content.active');
                if (activeTab && activeTab.id === 'databaseTab') {
                    await loadDatabaseTransactions();
                }
                closeVerifyModal();
            } catch (error) {
                console.error('Error confirming category:', error);
                showMessage('Errore nel salvare la verifica', 'error');
            }
        }

        function showCategorySelector() {
            const container = document.getElementById('categoryOptionsGrid');
            container.innerHTML = '';
            const allCategories = [
                'Alimentari', 'Trasporti', 'Ristoranti', 'Bollette', 'Viaggi', 'Commissioni Bancarie',
                'Shopping', 'Casa', 'Salute', 'Intrattenimento',
                'Sport', 'Educazione', 'Tecnologia', 'Benessere',
                'Acquisti Online', 'Prelievi', 'Bonifico', 'Paghetta',
                'Stipendio', 'Entrate Varie', 'Altre Spese'
            ];
            
            let filteredCategories = allCategories;
            // In single-transaction mode, filter by income/expense type
            if (currentVerifyTransaction) {
                const isIncome = currentVerifyTransaction.amount > 0;
                const incomeCategories = ['Stipendio', 'Entrate Varie'];
                filteredCategories = allCategories.filter(name => {
                    if (isIncome) return incomeCategories.includes(name);
                    else return !incomeCategories.includes(name);
                });
            }
            
            filteredCategories.forEach(name => {
                const option = document.createElement('div');
                option.className = 'category-option';
                option.onclick = () => changeCategory(name);
                
                option.innerHTML = `
                    <div class="category-option-icon">
                        <i data-lucide="${getCategoryIcon(name)}"></i>
                    </div>
                    <span>${name}</span>
                `;
                container.appendChild(option);
            });
            document.getElementById('categorySelectorDiv').style.display = 'block';
            document.getElementById('verifyActionButtons').style.display = 'none';
            setTimeout(refreshIcons, 50);
        }

        /**
         * Conta le transazioni con lo stesso nome merchant (escludendo quella corrente)
         */
        async function countSimilarTransactions(description, excludeId) {
            try {
                const result = await apiCall(`/api/transactions?limit=1000${lastUploadedFileId ? `&uploadedFileId=${lastUploadedFileId}` : ''}`);
                const all = result.data.transactions || [];
                return all.filter(t => t.description === description && t.id !== excludeId).length;
            } catch (e) {
                return 0;
            }
        }

        async function changeCategory(newCategory) {
            if (window.isBulkEditMode && window.selectedTransactions.size > 0) {
                return confirmBulkCategory(newCategory);
            }

            if (!currentVerifyTransaction) return;
            try {
                // 🧠 Cerca altre transazioni con lo stesso nome merchant
                const similarCount = await countSimilarTransactions(currentVerifyTransaction.description, currentVerifyTransaction.id);

                if (similarCount > 0) {
                    const applyAll = confirm(`Ci sono ${similarCount} altra/e transazioni di "${currentVerifyTransaction.description}"!\n\nVuoi cambiare anche la loro categoria in "${newCategory}"? Clicca OK per tutte, Annulla per solo questa.`);
                    if (applyAll) {
                        showMessage(`Applicando "${newCategory}" a tutte le transazioni...`, 'info');
                        await apiCall(`/api/transactions/bulk-verify-by-description`, {
                            method: 'PUT',
                            body: JSON.stringify({
                                description: currentVerifyTransaction.description,
                                category: newCategory,
                                isVerified: true,
                                confidence: 1.0
                            })
                        });
                        showMessage(`"${newCategory}" applicata a tutte le transazioni di "${currentVerifyTransaction.description}"!`, 'success');
                    } else {
                        await apiCall(`/api/transactions/${currentVerifyTransaction.id}`, {
                            method: 'PUT',
                            body: JSON.stringify({ category: newCategory, isVerified: true, confidence: 1.0 })
                        });
                        showMessage(`Categoria cambiata in "${newCategory}" per questa transazione.`, 'success');
                    }
                } else {
                    await apiCall(`/api/transactions/${currentVerifyTransaction.id}`, {
                        method: 'PUT',
                        body: JSON.stringify({ category: newCategory, isVerified: true, confidence: 1.0 })
                    });
                    showMessage(`Categoria cambiata in "${newCategory}"! Il sistema ha imparato.`, 'success');
                }

                await updateTransactionsFromAPI();
                await updateStatsFromAPI();

                // ✅ Se il modal categoria è aperto, rinfrescalo immediatatamente
                if (currentModalCategory) {
                    await showCategoryDetails(currentModalCategory);
                }

                const activeTab = document.querySelector('.tab-content.active');
                if (activeTab && activeTab.id === 'databaseTab') {
                    await loadDatabaseTransactions();
                }
                closeVerifyModal();
            } catch (error) {
                console.error('Error changing category:', error);
                showMessage('Errore nel cambiare categoria', 'error');
            }
        }

        // --- BULK EDIT LOGIC ---
        function toggleSelection(id, element) {
            const checkbox = element.querySelector('.tx-checkbox');
            if (window.selectedTransactions.has(id)) {
                window.selectedTransactions.delete(id);
                checkbox.checked = false;
                element.classList.remove('selected');
            } else {
                window.selectedTransactions.add(id);
                checkbox.checked = true;
                element.classList.add('selected');
            }
            updateBulkActionBar();
        }

        function updateBulkActionBar() {
            const bar = document.getElementById('bulkActionBar');
            const badge = document.getElementById('bulkCountBadge');
            
            if (window.selectedTransactions.size > 0) {
                badge.textContent = window.selectedTransactions.size;
                bar.classList.add('visible');
            } else {
                bar.classList.remove('visible');
            }
        }

        function clearSelection() {
            window.selectedTransactions.clear();
            const checkboxes = document.querySelectorAll('.tx-checkbox');
            checkboxes.forEach(cb => cb.checked = false);
            const items = document.querySelectorAll('.transaction-item-v2.selected');
            items.forEach(el => el.classList.remove('selected'));
            updateBulkActionBar();
            window.isBulkEditMode = false;
        }

        function openBulkCategoryModal() {
            window.isBulkEditMode = true;

            // ✅ Use stable IDs - no fragile CSS selector chains
            document.getElementById('verifyModalTitle').textContent = `Modifica Massiva (${window.selectedTransactions.size} Transazioni)`;
            document.getElementById('verifyTransactionDesc').textContent = `Stai modificando la categoria di ${window.selectedTransactions.size} transazioni selezionate`;
            document.getElementById('verifyTransactionDate').innerHTML = '';
            document.getElementById('verifyTransactionAmount').textContent = '';
            
            // Hide single-transaction sections, show only category selector
            document.getElementById('verifyTransactionInfoSection').style.display = 'block';
            document.getElementById('verifyCurrentCategorySection').style.display = 'none';
            document.getElementById('verifyActionButtons').style.display = 'none';
            
            showCategorySelector();
            document.getElementById('verifyTransactionModal').style.display = 'block';
        }

        async function confirmBulkCategory(newCategory) {
            try {
                showMessage(`⏳ Aggiornamento di ${window.selectedTransactions.size} transazioni in corso...`, 'success');
                
                // Manda le chiamate API in parallelo
                const promises = Array.from(window.selectedTransactions).map(id => {
                    return apiCall(`/api/transactions/${id}`, {
                        method: 'PUT',
                        body: JSON.stringify({ category: newCategory, isVerified: true, confidence: 1.0 })
                    });
                });
                
                await Promise.all(promises);
                
                showMessage(`${window.selectedTransactions.size} transazioni aggiornate in "${newCategory}"!`, 'success');
                
                // Ripristina l'UI
                clearSelection();
                closeVerifyModal();
                
                // Aggiorna Tabelle
                await updateTransactionsFromAPI();
                await updateStatsFromAPI();
                const activeTab = document.querySelector('.tab-content.active');
                if (activeTab && activeTab.id === 'databaseTab') {
                    await loadDatabaseTransactions();
                }
                
            } catch (error) {
                console.error('Error during bulk update:', error);
                showMessage('Errore durante aggiornamento multiplo', 'error');
            }
        }
        // --- END BULK EDIT LOGIC ---

        async function updateCategoriesDisplay() {
            const container = document.getElementById('categoriesGrid');
            if (Object.keys(appData.categories).length === 0) {
                container.innerHTML = ''; // ✅ Rimosso robottino superfluo
                return;
            }

            container.innerHTML = '';
            const sortedCategories = Object.entries(appData.categories).sort((a, b) => b[1].amount - a[1].amount);

            sortedCategories.forEach(([categoryName, data]) => {
                const card = document.createElement('div');
                card.className = 'category-card';
                card.onclick = () => showCategoryDetails(categoryName);
                
                const catColor = data.color || '#f43f5e';
                const iconName = getCategoryIcon(categoryName);
                
                card.innerHTML = `
                    <div style="font-size: 32px; margin-bottom: 12px; color: ${catColor}; display: flex; justify-content: center;">
                        <i data-lucide="${iconName}" style="width: 32px; height: 32px;"></i>
                    </div>
                    <div style="font-weight: bold; margin-bottom: 5px;">${categoryName}</div>
                    <div style="color: ${catColor}; font-size: 14px;">${formatAmount(data.amount)}</div>
                    <div style="font-size: 12px; opacity: 0.7; margin-top: 5px;">${data.count} transazioni • AI Categorized</div>
                `;
                container.appendChild(card);
            });
            
            // Re-inizializza icone Lucide obbligatorio
            refreshIcons();
        }

        async function showCategoryDetails(categoryName) {
            try {
                // ✅ Usa il nuovo endpoint /category-details
                let url = `/api/transactions/category-details/${encodeURIComponent(categoryName)}`;
                const params = new URLSearchParams();

                if (lastUploadedFileId) {
                    params.append('uploadedFileId', lastUploadedFileId);
                }
                
                // Add global date filters
                const dateFrom = document.getElementById('dateFrom').value;
                const dateTo = document.getElementById('dateTo').value;
                if (dateFrom) params.append('dateFrom', dateFrom);
                if (dateTo) params.append('dateTo', dateTo);

                const queryString = params.toString();
                if (queryString) {
                    url += `?${queryString}`;
                    console.log('🎯 Dettagli categoria filtrati:', queryString);
                }
                
                console.log('📞 Chiamata API:', url);
                
                const result = await apiCall(url);
                const { category, transactions, stats } = result.data;

                console.log(`📊 Categoria "${categoryName}":`, {
                    transazioni: transactions.length,
                    totale: stats.total,
                    fileId: lastUploadedFileId,
                    fileName: lastUploadedFileName
                });

                currentModalCategory = categoryName;

                document.getElementById('modalCategoryTitle').innerHTML = `<div style="display:flex;align-items:center;gap:10px;"><i data-lucide="${getCategoryIcon(categoryName)}"></i> ${categoryName}</div>`;
                document.getElementById('modalCategoryAmount').textContent = formatAmount(stats.total);

                const container = document.getElementById('categoryTransactions');
                container.innerHTML = '';

                // ✅ Box informativo semplificato come richiesto
                const infoBox = document.createElement('div');
                infoBox.className = 'info-pill-modern'; 
                infoBox.style = `background: rgba(99, 102, 241, 0.1); border: 1px solid rgba(99, 102, 126, 241, 0.2); border-radius: 12px; padding: 12px; margin-bottom: 20px; text-align: center; font-size: 14px; color: ${isDarkMode() ? '#a5b4fc' : '#4338ca'}; font-weight: 500;`;
                infoBox.innerHTML = `<strong>${transactions.length}</strong> transazioni • Totale: <strong>${formatAmount(stats.total)}</strong>`;
                container.appendChild(infoBox);

                transactions.forEach(trans => {
                    const transDiv = document.createElement('div');
                    transDiv.className = 'transaction-item-v2'; 
                    transDiv.style.margin = '8px 0';
                    transDiv.style.cursor = 'default';
                    transDiv.innerHTML = `
                        <div style="display:flex; align-items:center; gap:12px; flex:1;">
                            <div class="edit-icon-btn" title="Cambia Categoria" style="cursor:pointer; color: #818cf8; background: rgba(129, 140, 248, 0.1); width: 32px; height: 32px; border-radius: 8px; display: flex; align-items: center; justify-content: center; transition: 0.2s;">
                                <i data-lucide="edit-2" style="width:16px; height:16px;"></i>
                            </div>
                            <div>
                                <div style="font-weight: 600; font-size: 14px;">${trans.description}</div>
                                <div style="font-size: 11px; opacity: 0.5;">${trans.date}</div>
                            </div>
                        </div>
                        <div style="font-weight: 700; color: #f43f5e; font-size: 15px;">${formatAmount(trans.amount)}</div>
                    `;
                    
                    // Aggiungi click handler per l'edit
                    const editBtn = transDiv.querySelector('.edit-icon-btn');
                    editBtn.addEventListener('click', (e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        console.log('✏️ Edit clicked for:', trans.description);
                        openEditFromModal(trans);
                    });

                    container.appendChild(transDiv);
                });

                if (transactions.length === 0) {
                    container.innerHTML = '<div style="text-align: center; opacity: 0.6; padding: 20px;">Nessuna transazione trovata per questa categoria nel periodo selezionato</div>';
                }

                document.getElementById('categoryModal').style.display = 'block';
                setTimeout(refreshIcons, 50);
            } catch (error) {
                console.error('Errore dettagli categoria:', error);
                showMessage('Errore nel caricamento dei dettagli categoria', 'error');
            }
        }

        function showDateFilter() {
            document.getElementById('dateFilter').style.display = 'flex';
        }

        async function applyDateFilter() {
            const dateFrom = document.getElementById('dateFrom').value;
            const dateTo = document.getElementById('dateTo').value;

            if (!dateFrom || !dateTo) {
                showMessage('Seleziona entrambe le date', 'error');
                return;
            }

            if (dateFrom > dateTo) {
                showMessage('Data inizio deve essere precedente alla data fine', 'error');
                return;
            }

            currentDateFilter = { from: dateFrom, to: dateTo };
            showMessage('Applicando filtro...', 'info');
            await updateStatsFromAPI();
            await updateTransactionsFromAPI(); // 🆕 Aggiorna anche le transazioni nella home
            drawPieChart(); drawMiniCharts();

            const fromFormatted = new Date(dateFrom).toLocaleDateString('it-IT');
            const toFormatted = new Date(dateTo).toLocaleDateString('it-IT');
            showMessage(`Filtro applicato: ${fromFormatted} - ${toFormatted}`, 'success');
        }

        async function applyLast30DaysFilter() {
            const today = new Date();
            const thirtyDaysAgo = new Date();
            thirtyDaysAgo.setDate(today.getDate() - 30);
            
            const from = thirtyDaysAgo.toISOString().split('T')[0];
            const to = today.toISOString().split('T')[0];
            
            document.getElementById('dateFrom').value = from;
            document.getElementById('dateTo').value = to;
            currentDateFilter = { from, to };
            
            console.log(`📅 Auto-Filter: Last 30 Days (${from} to ${to})`);
            await updateStatsFromAPI();
            await updateTransactionsFromAPI();
            drawPieChart(); drawMiniCharts();
        }

        async function clearDateFilter() {
            // Se abbiamo un range di date originale del file E stiamo visualizzando quel file, lo ripristiniamo
            if (lastUploadedFileId && lastFileDateRange) {
                const dates = lastFileDateRange.split(' to ');
                if (dates.length === 2 && dates[0] && dates[1]) {
                    const from = dates[0].trim();
                    const to = dates[1].trim();
                    
                    document.getElementById('dateFrom').value = from;
                    document.getElementById('dateTo').value = to;
                    currentDateFilter = { from, to };
                    
                    showMessage(`Date ripristinate al range del file: ${from} - ${to}`, 'info');
                } else {
                    currentDateFilter = null;
                    document.getElementById('dateFrom').value = '';
                    document.getElementById('dateTo').value = '';
                    showMessage('Filtri data rimossi', 'info');
                }
            } else {
                currentDateFilter = null;
                document.getElementById('dateFrom').value = '';
                document.getElementById('dateTo').value = '';
                console.log('🧹 Filtri data rimossi completamente (Modalità Banca/Global)');
                showMessage('Filtri data rimossi', 'info');
            }
            
            // ✅ Non rimuovere lastUploadedFileId automaticamente per non mostrare il "Memory DB" da 3M euro
            // se l'utente ha appena caricato un file.
            
            if (lastUploadedFileId) {
                document.getElementById('transactionsTitle').textContent = 'Transazioni File Corrente';
            } else {
                document.getElementById('transactionsTitle').textContent = 'Ultimi Movimenti (Global)';
            }
            await updateStatsFromAPI();
            await updateTransactionsFromAPI(); 
            drawPieChart(); drawMiniCharts();
            
            if (lastUploadedFileId) {
                showMessage('Mostrando tutte le transazioni del file corrente (senza limiti di data)', 'success');
            } else {
                showMessage('Mostrando tutti i dati globali', 'success');
            }
        }

        // ── Pig character state ──
        function setPigState(state) {
            const wrap = document.getElementById('balPigWrap');
            if (!wrap) return;
            wrap.classList.remove('pig-s-happy','pig-s-sad','pig-s-neutral');
            wrap.classList.add('pig-s-' + state);
        }

        // ── Pig coin burst ──
        const _coinEmojis = ['🪙','💰','💵'];
        function spawnCoinBurstAt(card, x, y, drift) {
            const coin = document.createElement('span');
            coin.className = 'pig-coin-burst';
            coin.textContent = _coinEmojis[Math.floor(Math.random() * _coinEmojis.length)];
            coin.style.left = x + 'px';
            coin.style.top  = y + 'px';
            coin.style.setProperty('--drift', (drift !== undefined ? drift : (Math.random() - 0.5) * 32) + 'px');
            card.appendChild(coin);
            setTimeout(() => coin.remove(), 1300);
        }
        function spawnCoinBurst(extraDrift) {
            const card = document.getElementById('balanceCard');
            const wrap = document.getElementById('balPigWrap');
            if (!card || !wrap) return;
            const cr = card.getBoundingClientRect();
            const wr = wrap.getBoundingClientRect();
            spawnCoinBurstAt(card,
                wr.left - cr.left + wr.width * 0.5,
                wr.top  - cr.top  + wr.height * 0.20,
                extraDrift
            );
        }

        // ── Pig figure-8 (Lissajous 1:2) with 3D transforms ──
        let _pig8Raf   = null;
        let _pig8T     = 0;
        let _pig8LoopN = 0;

        function startPigFigureEight() {
            stopPigFigureEight();
            const wrap = document.getElementById('balPigWrap');
            const play = document.getElementById('pigPlayground');
            const card = document.getElementById('balanceCard');
            if (!wrap || !play || !card) return;

            const PW = wrap.offsetWidth  || 64;
            const PH = wrap.offsetHeight || 64;
            const CW = play.offsetWidth  || card.offsetWidth;
            const CH = play.offsetHeight || card.offsetHeight;

            const cx    = CW * 0.47;
            const cy    = CH * 0.50;
            const RxMax = CW * 0.40 - PW * 0.5;
            const RyMax = Math.max(10, CH * 0.28 - PH * 0.5);

            function loop() {
                _pig8T += 0.022;
                const t    = _pig8T;
                const slow = t * 0.035;

                // Slowly morphing radii + phase (changes trajectory every ~15 s)
                const Rx = RxMax * (0.82 + 0.18 * Math.cos(slow * 0.6));
                const Ry = RyMax * (0.45 + 0.55 * Math.abs(Math.sin(slow * 0.4)));
                const ph = Math.sin(slow * 0.25) * 0.7;

                // Lissajous 1:2 = figure-8
                const x = cx + Rx * Math.sin(t);
                const y = cy + Ry * Math.sin(2 * t + ph);

                // Analytical velocity
                const vx    = Rx * Math.cos(t);
                const vy    = 2 * Ry * Math.cos(2 * t + ph);
                const speed = Math.sqrt(vx * vx + vy * vy) || 1;

                // Facing direction (flip horizontally)
                const flipX = vx >= 0 ? 1 : -1;

                // Bank angle (lean into turn)
                const bankDeg = Math.max(-28, Math.min(28, (vy / speed) * 22));

                // rotateY foreshortening: strong when moving horizontally
                const hFrac  = Math.abs(vx) / speed;
                const rotY   = hFrac * 38;

                // Depth scale: smaller when pig is higher (perspective)
                const normY  = CH > PH ? (y - PH * 0.5) / (CH - PH) : 0.5;
                const depthS = 0.68 + 0.32 * Math.max(0, Math.min(1, normY));

                // Position
                wrap.style.left  = Math.max(0, Math.min(CW - PW, x - PW * 0.5)) + 'px';
                wrap.style.top   = Math.max(0, Math.min(CH - PH, y - PH * 0.5)) + 'px';
                wrap.style.right = 'auto';

                // Full 3D transform
                wrap.style.transform =
                    `perspective(320px) scaleX(${flipX}) rotateY(${-rotY}deg) rotateZ(${bankDeg * flipX}deg) scale(${depthS})`;

                // Coins on each completed loop
                const loopN = Math.floor(t / (Math.PI * 2));
                if (loopN > _pig8LoopN) {
                    _pig8LoopN = loopN;
                    spawnCoinBurstAt(card, x, y - PH * 0.35, -10);
                    setTimeout(() => spawnCoinBurstAt(card, x, y - PH * 0.35, 13), 170);
                }

                _pig8Raf = requestAnimationFrame(loop);
            }
            _pig8Raf = requestAnimationFrame(loop);
        }
        function stopPigFigureEight() {
            if (_pig8Raf) { cancelAnimationFrame(_pig8Raf); _pig8Raf = null; }
        }

        // ── Periodic coin timer (independent) ──
        let _coinBurstTimer = null;
        function startCoinBursts() {
            stopCoinBursts();
            const pigPlayground = document.getElementById('pigPlayground');
            if (pigPlayground && pigPlayground.style.display === 'none') return;
            setTimeout(startPigFigureEight, 120);   // start figure-8 after card renders
            function schedNext() {
                _coinBurstTimer = setTimeout(() => { spawnCoinBurst(); schedNext(); }, 4000 + Math.random() * 5000);
            }
            schedNext();
        }
        function stopCoinBursts() {
            if (_coinBurstTimer) { clearTimeout(_coinBurstTimer); _coinBurstTimer = null; }
            stopPigFigureEight();
        }

        // ── Tap: coin burst at current pig position ──
        function pigTap() {
            const card = document.getElementById('balanceCard');
            const wrap = document.getElementById('balPigWrap');
            if (!card || !wrap) return;
            const cr = card.getBoundingClientRect();
            const wr = wrap.getBoundingClientRect();
            const x  = wr.left - cr.left + wr.width  * 0.5;
            const y  = wr.top  - cr.top  + wr.height * 0.20;
            spawnCoinBurstAt(card, x, y, -14);
            setTimeout(() => spawnCoinBurstAt(card, x, y,   0), 140);
            setTimeout(() => spawnCoinBurstAt(card, x, y,  16), 260);
            wrap.style.filter = 'drop-shadow(0 0 18px rgba(250,204,21,0.9)) drop-shadow(0 4px 12px rgba(236,72,153,0.6))';
            setTimeout(() => { wrap.style.filter = ''; }, 550);
        }
        window.pigTap = pigTap;

        let miniChartInstance = null;
        function drawMiniCharts() {
            const cats = appData.categories || {};
            const sorted = Object.entries(cats).sort((a, b) => b[1].amount - a[1].amount);
            const total = sorted.reduce((s, [, c]) => s + c.amount, 0);

            // ── Mini Donut ──
            const canvas = document.getElementById('miniPieChart');
            const empty = document.getElementById('miniPieEmpty');
            if (canvas) {
                if (sorted.length === 0 || total === 0) {
                    canvas.style.display = 'none';
                    if (empty) empty.style.display = 'flex';
                } else {
                    canvas.style.display = 'block';
                    if (empty) empty.style.display = 'none';
                    if (miniChartInstance) { miniChartInstance.destroy(); miniChartInstance = null; }
                    miniChartInstance = new Chart(canvas, {
                        type: 'doughnut',
                        data: {
                            labels: sorted.map(([n]) => n),
                            datasets: [{ data: sorted.map(([, c]) => c.amount), backgroundColor: sorted.map(([, c]) => c.color || '#6366f1'), borderWidth: 1, borderColor: '#09090b', hoverOffset: 4 }]
                        },
                        options: { responsive: false, cutout: '68%', plugins: { legend: { display: false }, tooltip: { enabled: false } }, animation: { duration: 400 } }
                    });
                }
            }

            // ── Mini Bar List ──
            const barList = document.getElementById('miniBarList');
            if (barList) {
                if (sorted.length === 0) {
                    barList.innerHTML = '<div class="mic-bar-empty">Nessun dato</div>';
                } else {
                    const top = sorted.slice(0, 4);
                    const maxVal = top[0][1].amount;
                    barList.innerHTML = top.map(([name, cat]) => {
                        const pct = maxVal > 0 ? Math.round((cat.amount / maxVal) * 100) : 0;
                        const fmt = cat.amount >= 1000 ? `${(cat.amount/1000).toFixed(1)}k` : `${Math.round(cat.amount)}`;
                        return `<div class="mic-bar-row">
                            <div class="mic-bar-lbl">${name}</div>
                            <div class="mic-bar-track"><div class="mic-bar-fill" style="width:${pct}%;background:${cat.color||'#6366f1'};"></div></div>
                            <div class="mic-bar-val">€${fmt}</div>
                        </div>`;
                    }).join('');
                }
            }
        }
        window.drawMiniCharts = drawMiniCharts;

        function drawPieChart() {
            window.drawPieChart = drawPieChart;
            const canvas = document.getElementById('pieChart');
            const emptyChart = document.getElementById('emptyChart');
            const centerInfo = document.getElementById('pieCenterInfo');

            if (Object.keys(appData.categories).length === 0) {
                canvas.style.display = 'none';
                centerInfo.style.display = 'none';
                emptyChart.style.display = 'block';
                return;
            }

            canvas.style.display = 'block';
            centerInfo.style.display = 'flex';
            emptyChart.style.display = 'none';

            const total = Object.values(appData.categories).reduce((sum, cat) => sum + cat.amount, 0);
            if (total === 0) return;

            const fmtTotal = formatAmount(total);
            document.getElementById('pieCenterAmount').textContent = fmtTotal;
            const inner = document.getElementById('pieCenterAmountInner');
            if (inner) inner.textContent = fmtTotal;

            const sortedCategories = Object.entries(appData.categories).sort((a, b) => b[1].amount - a[1].amount);
            
            const labels = [];
            const data = [];
            const bgColors = [];

            sortedCategories.forEach(([categoryName, catData], index) => {
                labels.push(categoryName);
                data.push(catData.amount);
                // Usa il colore reale della categoria dal server, fallendo sul grigio se manca
                bgColors.push(catData.color || '#94a3b8');
            });

            if (chartInstance) {
                chartInstance.destroy();
            }

            Chart.defaults.color = isDarkMode() ? '#94a3b8' : '#1e293b';
            Chart.defaults.font.family = "'Inter', sans-serif";

            const chartColors = isDarkMode() ? 
                { border: '#11131c', tooltipBg: 'rgba(15, 17, 26, 0.95)', tooltipBorder: 'rgba(255,255,255,0.1)' } : 
                { border: '#ffffff', tooltipBg: 'rgba(255, 255, 255, 0.98)', tooltipBorder: 'rgba(0,0,0,0.1)' };

            chartInstance = new Chart(canvas, {
                type: 'doughnut',
                data: {
                    labels: labels,
                    datasets: [{
                        data: data,
                        backgroundColor: bgColors,
                        borderWidth: isDarkMode() ? 1 : 4,
                        borderColor: chartColors.border,
                        hoverOffset: 8
                    }]
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    cutout: '75%',
                    plugins: {
                        legend: {
                            display: false
                        },
                        tooltip: {
                            backgroundColor: chartColors.tooltipBg,
                            titleColor: isDarkMode() ? '#fff' : '#000',
                            bodyColor: isDarkMode() ? '#fff' : '#000',
                            titleFont: { size: 14, family: "'Inter', sans-serif" },
                            bodyFont: { size: 13, family: "'Inter', sans-serif" },
                            padding: 12,
                            cornerRadius: 8,
                            borderColor: chartColors.tooltipBorder,
                            borderWidth: 1,
                            callbacks: {
                                label: function(context) {
                                    let label = context.label || '';
                                    if (label) {
                                        label += ': ';
                                    }
                                    if (context.parsed !== null) {
                                        label += formatAmount(context.parsed);
                                    }
                                    return label;
                                }
                            }
                        }
                    },
                    onClick: (event, elements) => {
                        if (elements.length > 0) {
                            const index = elements[0].index;
                            const categoryName = labels[index];
                            showCategoryDetails(categoryName);
                        }
                    }
                }
            });
        }

        function getCategoryIcon(category) {
            const iconMap = {
                'Alimentari': 'shopping-cart', 'Trasporti': 'car', 'Ristoranti': 'utensils',
                'Bollette': 'zap', 'Shopping': 'shopping-bag', 'Prelievi': 'banknote', 'Casa': 'home',
                'Salute': 'pill', 'Intrattenimento': 'film', 'Sport': 'dumbbell',
                'Educazione': 'book-open', 'Tecnologia': 'laptop', 'Stipendio': 'coins',
                'Benessere': 'scissors', 'Bonifico': 'credit-card', 'Paghetta': 'baby',
                'Entrate Varie': 'wallet', 'Altre Spese': 'receipt', 'Acquisti Online': 'package',
                'Viaggi': 'plane', 'Commissioni Bancarie': 'landmark'
            };
            return iconMap[category] || 'help-circle';
        }

        function switchTab(tabName) {
            console.log('🔄 Switching to tab:', tabName);
            
            // ✅ Nascondi TUTTE le tab
            document.querySelectorAll('.tab').forEach(tab => tab.classList.remove('active'));
            document.querySelectorAll('.tab-content').forEach(content => {
                content.classList.remove('active');
                content.style.display = 'none';
            });

            // ✅ Mostra SOLO la tab selezionata
            const targetTab = document.querySelector(`[onclick="switchTab('${tabName}')"]`);
            const targetContent = document.getElementById(tabName + 'Tab');

            if (targetTab) targetTab.classList.add('active');
            if (targetContent) {
                targetContent.classList.add('active');
                targetContent.style.display = 'block';
            }

            // ✅ GESTISCI TUTTI GLI ELEMENTI DB ADMIN - Mostra SOLO quando sei su DB Admin
            const adminFilters = document.getElementById('adminFiltersSection');
            const adminList = document.getElementById('adminTransactionsList');
            const adminPagination = document.getElementById('adminPagination');
            
            if (tabName === 'database') {
                // Mostra tutto il DB Admin
                if (adminFilters) adminFilters.style.display = 'block';
                if (adminList) adminList.style.display = 'block';
                populateAdminCategoryFilter();
                // 🆕 Carica statistiche Google Places
                loadGooglePlacesStats();
            } else {
                // Nascondi tutto il DB Admin
                if (adminFilters) adminFilters.style.display = 'none';
                if (adminList) adminList.style.display = 'none';
                if (adminPagination) adminPagination.style.display = 'none';
            }

            if (tabName === 'categories') {
                drawPieChart(); drawMiniCharts();
            }

            if (tabName === 'home') {
                drawMiniCharts();
            }

            if (tabName === 'analysis') {
                loadAnalysisData();
            }
            
            if (tabName === 'travel') {
                loadTravels();
            }
            

            if (tabName === 'upload') {
                clearUploadHistory();
                // ✅ NON resettare lastUploadedFileId qui, altrimenti si perde il focus sul file appena caricato
                // lastUploadedFileId = null;
                // lastUploadedFileName = null;
                document.getElementById('transactionsTitle').textContent = 'Pronto per nuovo caricamento';
            }
        }

        function closeCategoryModal() {
            document.getElementById('categoryModal').style.display = 'none';
            currentModalCategory = null; // ✅ Reset tracking
        }

        function openEditFromModal(trans) {
            console.log('📝 Editing transaction from modal:', trans);
            
            // Chiudi il modal della categoria per evitare sovrapposizioni
            document.getElementById('categoryModal').style.display = 'none';
            
            // Usa la funzione standard per impostare tutti i dati e i badge
            openVerifyModal(trans);
            
            // Personalizza per la modalità "Cambia Categoria" immediata
            document.getElementById('verifyModalTitle').textContent = 'Cambia Categoria';
            showCategorySelector(); // Mostra subito la griglia delle categorie
        }

        function showTravelModal() {
            currentTravelId = null; // Forza modalità creazione
            document.getElementById('travelModal').style.display = 'block';
            document.querySelector('#travelModal h3').innerHTML = '<i data-lucide="plane"></i> Nuovo Viaggio';
            
            const today = new Date();
            const nextWeek = new Date(today.getTime() + 7 * 24 * 60 * 60 * 1000);
            document.getElementById('travelStartDate').value = today.toISOString().split('T')[0];
            document.getElementById('travelEndDate').value = nextWeek.toISOString().split('T')[0];
        }

        function closeTravelModal() {
            document.getElementById('travelModal').style.display = 'none';
            currentTravelId = null;
        }

        async function saveTravel() {
            const destination = document.getElementById('travelDestination').value;
            const startDate = document.getElementById('travelStartDate').value;
            const endDate = document.getElementById('travelEndDate').value;
            const budget = document.getElementById('travelBudget').value;

            if (!destination || !startDate || !endDate) {
                showMessage('Destinazione e date sono obbligatorie', 'error');
                return;
            }

            try {
                const method = currentTravelId ? 'PUT' : 'POST';
                const url = currentTravelId ? `/api/travels/${currentTravelId}` : '/api/travels';
                
                const result = await apiCall(url, {
                    method: method,
                    body: JSON.stringify({ destination, startDate, endDate, budget })
                });

                if (result.success) {
                    showMessage(currentTravelId ? 'Viaggio aggiornato!' : 'Viaggio creato!', 'success');
                    closeTravelModal();
                    await loadTravels();
                    
                    if (currentTravelId) {
                        // Se stavamo guardando i dettagli, rinfrescali
                        showTravelDetails(currentTravelId);
                    }
                }
            } catch (error) {
                console.error('Error saving travel:', error);
                showMessage('Errore nel salvataggio del viaggio', 'error');
            }
        }

        async function showTravelDetails(id) {
            try {
                const result = await apiCall(`/api/travels/${id}`);
                if (result.success) {
                    const travel = result.data;
                    currentTravelId = id;
                    
                    document.getElementById('tdDestText').textContent = travel.destination;
                    document.getElementById('tdDates').innerHTML = `
                        <i data-lucide="calendar" style="width: 12px; height: 12px;"></i> 
                        ${new Date(travel.startDate).toLocaleDateString('it-IT')} - ${new Date(travel.endDate).toLocaleDateString('it-IT')}
                    `;
                    document.getElementById('tdSpent').textContent = `€ ${travel.spent.toFixed(2)}`;
                    document.getElementById('tdBudget').textContent = `€ ${travel.budget.toFixed(2)}`;
                    
                    const listContainer = document.getElementById('tdTransactionsList');
                    listContainer.innerHTML = '';
                    
                    if (travel.transactions.length === 0) {
                        listContainer.innerHTML = '<div style="text-align: center; opacity: 0.5; padding: 20px;">Nessuna transazione associata</div>';
                    } else {
                        travel.transactions.forEach(t => {
                            const item = document.createElement('div');
                            item.style.cssText = `
                                display: flex;
                                justify-content: space-between;
                                align-items: center;
                                background: rgba(255,255,255,0.03);
                                padding: 10px 15px;
                                border-radius: 10px;
                                border: 1px solid rgba(255,255,255,0.05);
                            `;
                            item.innerHTML = `
                                <div style="flex: 1; min-width: 0;">
                                    <div style="font-weight: 500; font-size: 14px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${t.description}</div>
                                    <div style="font-size: 11px; opacity: 0.6;">${t.date} | ${t.category}</div>
                                </div>
                                <div style="text-align: right; margin: 0 15px;">
                                    <div style="font-weight: 700; color: ${t.amount > 0 ? 'var(--accent-success)' : '#fff'};">€ ${Math.abs(t.amount).toFixed(2)}</div>
                                </div>
                                <button onclick="removeTransactionFromTravel('${id}', '${t.id}')" style="background: none; border: none; color: #f43f5e; cursor: pointer; padding: 5px;" title="Rimuovi dal viaggio">
                                    <i data-lucide="minus-circle" style="width: 18px; height: 18px;"></i>
                                </button>
                            `;
                            listContainer.appendChild(item);
                        });
                    }
                    
                    document.getElementById('travelDetailsModal').style.display = 'block';
                    setTimeout(refreshIcons, 50);
                }
            } catch (error) {
                console.error('Error loading travel details:', error);
                showMessage('Errore nel caricamento dei dettagli', 'error');
            }
        }

        function closeTravelDetailsModal() {
            document.getElementById('travelDetailsModal').style.display = 'none';
            currentTravelId = null;
        }

        function openEditTravelFromDetails() {
            const travelId = currentTravelId; // Salva ID prima di chiudere dettagli
            const travel = appData.travels.find(t => t.id === travelId);
            if (!travel) return;

            // Chiudi i dettagli prima di aprire l'edit
            closeTravelDetailsModal();
            
            // Imposta ID per modalità modifica
            currentTravelId = travelId;

            document.getElementById('travelDestination').value = travel.destination;
            document.getElementById('travelStartDate').value = new Date(travel.startDate).toISOString().split('T')[0];
            document.getElementById('travelEndDate').value = new Date(travel.endDate).toISOString().split('T')[0];
            document.getElementById('travelBudget').value = travel.budget;
            
            document.getElementById('travelModal').style.display = 'block';
            document.querySelector('#travelModal h3').innerHTML = '<i data-lucide="edit-3"></i> Modifica Viaggio';
            setTimeout(refreshIcons, 50);
        }

        async function removeTransactionFromTravel(travelId, transactionId) {
            if (!confirm('Rimuovere questa transazione dal viaggio?')) return;
            
            try {
                const result = await apiCall(`/api/travels/${travelId}/transactions/${transactionId}`, {
                    method: 'DELETE'
                });
                if (result.success) {
                    showMessage('Transazione rimossa dal viaggio', 'success');
                    await loadTravels(); // Aggiorna lista generale
                    showTravelDetails(travelId); // Aggiorna dettagli aperti
                }
            } catch (error) {
                console.error('Error removing transaction from travel:', error);
                showMessage('Errore nella rimozione', 'error');
            }
        }

        async function loadTravels() {
            try {
                const result = await apiCall('/api/travels');
                if (result.success) {
                    appData.travels = result.data;
                    renderTravels();
                }
            } catch (error) {
                console.error('Error loading travels:', error);
            }
        }

        function renderTravels() {
            const container = document.getElementById('travelsList');
            if (!container) return;

            if (appData.travels.length === 0) {
                container.innerHTML = `
                    <div class="tab-empty-state">
                        <i data-lucide="plane" class="tab-empty-icon"></i>
                        <div class="tab-empty-title">Nessun viaggio ancora</div>
                        <div class="tab-empty-sub">Crea il tuo primo viaggio per raggruppare le spese</div>
                    </div>
                `;
                setTimeout(refreshIcons, 50);
                return;
            }

            container.innerHTML = `<div style="display: grid; grid-template-columns: repeat(auto-fill, minmax(300px, 1fr)); gap: 15px;"></div>`;
            const grid = container.firstChild;

            appData.travels.forEach(travel => {
                const rawPercent = travel.budget > 0 ? (travel.spent / travel.budget) * 100 : 0;
                const percent = Math.min(100, rawPercent);
                const statusColor = rawPercent > 100 ? '#f43f5e' : (rawPercent > 75 ? '#fbbf24' : 'var(--accent-success)');
                
                const card = document.createElement('div');
                card.className = 'card';
                card.style.position = 'relative';
                card.style.cursor = 'pointer';
                card.onclick = (e) => {
                    // Evita di aprire i dettagli se clicco su elimina
                    if (e.target.closest('button')) return;
                    showTravelDetails(travel.id);
                };
                card.innerHTML = `
                    <div style="display: flex; justify-content: space-between; align-items: start; margin-bottom: 15px;">
                        <div>
                            <h4 style="margin: 0; font-size: 18px;">${travel.destination}</h4>
                            <div style="font-size: 12px; opacity: 0.6; margin-top: 4px;">
                                <i data-lucide="calendar" style="width: 12px; height: 12px;"></i> 
                                ${new Date(travel.startDate).toLocaleDateString('it-IT')} - ${new Date(travel.endDate).toLocaleDateString('it-IT')}
                            </div>
                        </div>
                        <button onclick="deleteTravel('${travel.id}')" style="background: none; border: none; color: #f43f5e; cursor: pointer; opacity: 0.6;" title="Elimina viaggio">
                            <i data-lucide="trash-2" style="width: 18px; height: 18px;"></i>
                        </button>
                    </div>
                    
                    <div style="display: flex; justify-content: space-between; margin-bottom: 8px; font-size: 14px;">
                        <span>Speso: <strong>€ ${travel.spent.toFixed(2)}</strong></span>
                        <span>Budget: € ${travel.budget.toFixed(2)}</span>
                    </div>
                    
                    <div style="width: 100%; background: rgba(255,255,255,0.1); height: 8px; border-radius: 4px; overflow: hidden; margin-bottom: 15px;">
                        <div style="width: ${percent}%; background: ${statusColor}; height: 100%; border-radius: 4px;"></div>
                    </div>
                    
                    <div style="display: flex; gap: 10px; font-size: 12px; opacity: 0.8;">
                        <span style="background: rgba(255,255,255,0.05); padding: 4px 8px; border-radius: 6px;">
                            <i data-lucide="list" style="width: 12px; height: 12px; vertical-align: middle;"></i> ${travel.transactionCount} transazioni
                        </span>
                    </div>
                `;
                grid.appendChild(card);
            });
            setTimeout(refreshIcons, 50);
        }

        async function deleteTravel(id) {
            if (!confirm('Sei sicuro di voler eliminare questo viaggio? Le transazioni associate NON verranno eliminate.')) return;
            
            try {
                const result = await apiCall(`/api/travels/${id}`, { method: 'DELETE' });
                if (result.success) {
                    showMessage('Viaggio eliminato', 'success');
                    await loadTravels();
                }
            } catch (error) {
                console.error('Error deleting travel:', error);
                showMessage('Errore nell\'eliminazione del viaggio', 'error');
            }
        }

        // --- BULK TRAVEL LOGIC ---
        function openBulkTravelModal() {
            if (window.selectedTransactions.size === 0) {
                showMessage('Seleziona almeno una transazione', 'warning');
                return;
            }
            
            const optionsContainer = document.getElementById('selectTravelOptions');
            optionsContainer.innerHTML = '';
            
            if (appData.travels.length === 0) {
                optionsContainer.innerHTML = '<div style="text-align: center; padding: 20px; opacity: 0.6;">Nessun viaggio disponibile. Creane uno nella tab Viaggi.</div>';
            } else {
                appData.travels.forEach(travel => {
                    const option = document.createElement('div');
                    option.style.cssText = `
                        background: rgba(255,255,255,0.05);
                        border: 1px solid rgba(255,255,255,0.1);
                        border-radius: 10px;
                        padding: 12px 15px;
                        cursor: pointer;
                        display: flex;
                        justify-content: space-between;
                        align-items: center;
                        transition: all 0.2s;
                    `;
                    option.onmouseover = () => option.style.background = 'rgba(255,255,255,0.1)';
                    option.onmouseout = () => option.style.background = 'rgba(255,255,255,0.05)';
                    option.onclick = () => addSelectedToTravel(travel.id);
                    
                    option.innerHTML = `
                        <div>
                            <div style="font-weight: 600;">${travel.destination}</div>
                            <div style="font-size: 11px; opacity: 0.6;">${new Date(travel.startDate).toLocaleDateString('it-IT')}</div>
                        </div>
                        <i data-lucide="chevron-right" style="width: 16px; height: 16px; opacity: 0.5;"></i>
                    `;
                    optionsContainer.appendChild(option);
                });
            }
            
            document.getElementById('selectTravelModal').style.display = 'block';
            setTimeout(refreshIcons, 50);
        }

        function closeSelectTravelModal() {
            document.getElementById('selectTravelModal').style.display = 'none';
        }

        async function addSelectedToTravel(travelId) {
            const transactionIds = Array.from(window.selectedTransactions);
            const travel = appData.travels.find(t => t.id === travelId);
            
            try {
                const result = await apiCall(`/api/travels/${travelId}/transactions`, {
                    method: 'POST',
                    body: JSON.stringify({ transactionIds })
                });

                if (result.success) {
                    showMessage(`Aggiunte ${transactionIds.length} transazioni a "${travel.destination}"!`, 'success');
                    closeSelectTravelModal();
                    clearSelection();
                    await loadTravels(); // Refresh travel stats
                }
            } catch (error) {
                console.error('Error adding to travel:', error);
                showMessage('Errore nell\'aggiunta delle transazioni al viaggio', 'error');
            }
        }

        function showKidModal() {
            document.getElementById('kidModal').style.display = 'block';
        }

        function closeKidModal() {
            document.getElementById('kidModal').style.display = 'none';
        }

        function createKid() {
            showMessage('Funzionalità paghette sarà implementata nelle prossime API', 'success');
            closeKidModal();
        }

        async function toggleShowAll() {
            showMessage('Tutte le transazioni del file sono già visibili', 'success');
        }

        function clearFileFilter() {
            showMessage('Vai su "DB Admin" per vedere tutte le transazioni', 'success');
        }

        function clearFileFilterFromCategories() {
            showMessage('Vai su "DB Admin" per vedere tutto lo storico', 'success');
        }

        async function loadDatabaseTransactions() {
            console.log('🗄️ Caricamento TUTTE le transazioni dal database...');
            const container = document.getElementById('adminTransactionsList');
            
            // ✅ Mostra loader solo se non è già stato caricato
            if (container.querySelector('.loading-initial')) {
                container.innerHTML = '<div style="text-align: center; padding: 40px;"><div style="font-size: 32px; margin-bottom: 10px;">⏳</div>Caricamento transazioni database...</div>';
            }

            try {
                const params = new URLSearchParams({
                    page: adminCurrentPage,
                    limit: 50,
                    includeMemory: 'true' // ✅ Permette di vedere anche la "Memoria" nel DB Admin
                });

                if (adminFilters.search) {
                    params.append('search', adminFilters.search);
                }
                if (adminFilters.category) {
                    params.append('category', adminFilters.category);
                }
                if (adminFilters.verified === 'verified') {
                    params.append('needsReview', 'false');
                } else if (adminFilters.verified === 'unverified') {
                    params.append('needsReview', 'true');
                }

                const result = await apiCall(`/api/transactions?${params}`);
                const { transactions, pagination } = result.data;
                
                const needsReviewCount = transactions.filter(t => !t.isVerified && t.confidence < 0.8).length;
                const dbStatsEl = document.getElementById('dbStats');
                dbStatsEl.innerHTML = `
                    <i data-lucide="bar-chart-2" style="width:14px;height:14px;"></i> ${pagination.total} transazioni totali • 
                    ${needsReviewCount > 0 ? `<span style="color: #feca57; display:inline-flex; align-items:center; gap:4px;"><i data-lucide="alert-triangle" style="width:14px;height:14px;"></i> ${needsReviewCount} da verificare in questa pagina</span>` : '<span style="color: var(--accent-success); display:inline-flex; align-items:center; gap:4px;"><i data-lucide="check-circle-2" style="width:14px;height:14px;"></i> Tutte verificate in questa pagina</span>'}
                `;

                if (transactions.length === 0) {
                    container.innerHTML = '<div style="text-align: center; opacity: 0.6; padding: 40px;"><i data-lucide="database" style="width:48px;height:48px;margin-bottom:15px;color:#a78bfa;"></i><div>Nessuna transazione trovata</div></div>';
                    document.getElementById('adminPagination').style.display = 'none';
                    return;
                }

                container.innerHTML = '';

                transactions.forEach(trans => {
                    const isIncome = trans.amount > 0;
                    const color = isIncome ? 'var(--accent-success)' : '#f43f5e';
                    const sign = isIncome ? '+' : '-';
                    const confidence = trans.confidence || 0;
                    
                    let confidenceBadge = '', confidenceColor = 'var(--accent-success)';
                    if (confidence >= 0.8) {
                        confidenceBadge = '<span style="display:inline-flex;align-items:center;gap:4px;color:var(--accent-success);"><i data-lucide="check-circle-2" style="width:14px;height:14px;"></i> Alta</span>';
                        confidenceColor = 'var(--accent-success)';
                    } else if (confidence >= 0.5) {
                        confidenceBadge = '<span style="display:inline-flex;align-items:center;gap:4px;color:#facc15;"><i data-lucide="alert-triangle" style="width:14px;height:14px;"></i> Media</span>';
                        confidenceColor = '#feca57';
                    } else {
                        confidenceBadge = '<span style="display:inline-flex;align-items:center;gap:4px;color:var(--accent-danger);"><i data-lucide="help-circle" style="width:14px;height:14px;"></i> Bassa</span>';
                        confidenceColor = '#f43f5e';
                    }

                    const transDiv = document.createElement('div');
                    transDiv.className = 'transaction-item';
                    transDiv.style.cursor = 'pointer';
                    transDiv.onclick = () => openAdminEditModal(trans);
                    
                    transDiv.innerHTML = `
                        <div style="flex: 1;">
                            <div style="font-weight: bold; margin-bottom: 4px;">${trans.description}</div>
                            <div style="font-size: 12px; opacity: 0.7; display: flex; align-items: center; gap: 8px; flex-wrap: wrap;">
                                <span style="display:inline-flex;align-items:center;gap:4px;"><i data-lucide="calendar" style="width:14px;height:14px;"></i> ${trans.date}</span>
                                <span>•</span>
                                <span style="background: rgba(102, 126, 234, 0.2); padding: 2px 8px; border-radius: 10px; color: #667eea;">${trans.category}</span>
                                ${!trans.isVerified ? `
                                <span style="background: rgba(${confidenceColor === 'var(--accent-success)' ? '74, 222, 128' : confidenceColor === '#feca57' ? '254, 202, 87' : '248, 113, 113'}, 0.2); padding: 2px 8px; border-radius: 10px; color: ${confidenceColor}; font-size: 11px;">
                                     ${confidenceBadge}  (${(confidence * 100).toFixed(0)}%)
                                </span>
                                ` : '<span style="color: var(--accent-success); font-size: 11px;">✓ Verificata</span>'}
                                ${trans.sourceFile ? `<span style="font-size: 11px; opacity: 0.6; display:inline-flex;align-items:center;gap:4px;"><i data-lucide="file-text" style="width:12px;height:12px;"></i> ${trans.sourceFile}</span>` : ''}
                            </div>
                        </div>
                        <div style="font-weight: bold; color: ${color}; text-align: right;">
                            <div style="font-size: 18px;">${sign}€ ${Math.abs(trans.amount).toFixed(2)}</div>
                            <div style="font-size: 11px; opacity: 0.7; display:inline-flex;align-items:center;gap:4px;"><i data-lucide="edit-2" style="width:12px;height:12px;"></i> Click per modificare</div>
                        </div>
                    `;
                    container.appendChild(transDiv);
                });

                const paginationEl = document.getElementById('adminPagination');
                const pageInfo = document.getElementById('adminPageInfo');
                paginationEl.style.display = 'flex';
                pageInfo.textContent = `Pagina ${pagination.page} di ${pagination.totalPages} (${pagination.total} totali)`;

                console.log(`✅ Caricate ${transactions.length} transazioni (pagina ${pagination.page})`);

            } catch (error) {
                console.error('❌ Errore caricamento transazioni database:', error);
                container.innerHTML = '<div style="text-align: center; color: #f43f5e; padding: 20px;"><i data-lucide="alert-circle" style="display:block;margin:0 auto 10px;width:32px;height:32px;"></i> Errore caricamento transazioni</div>';
            }
        }

        function populateAdminCategoryFilter() {
            const select = document.getElementById('adminFilterCategory');
            const categories = [
                'Alimentari', 'Trasporti', 'Ristoranti', 'Prelievi', 'Bollette', 'Shopping',
                'Casa', 'Salute', 'Intrattenimento', 'Sport', 'Educazione',
                'Tecnologia', 'Benessere', 'Acquisti Online', 'Bonifico', 'Paghetta',
                'Stipendio', 'Entrate Varie', 'Altre Spese', 'Viaggi', 'Commissioni Bancarie'
            ];
            
            select.innerHTML = '<option value="">Tutte le categorie</option>';
            categories.forEach(cat => {
                const option = document.createElement('option');
                option.value = cat;
                option.innerHTML = `&#x25A0; ${cat}`; // Lucide doesn't render directly inside <option> tag easily, use text
                option.setAttribute('data-icon', getCategoryIcon(cat));
                select.appendChild(option);
            });
        }

        function applyAdminFilters() {
            adminFilters.search = document.getElementById('adminSearchText').value;
            adminFilters.category = document.getElementById('adminFilterCategory').value;
            adminFilters.verified = document.getElementById('adminFilterVerified').value;
            adminCurrentPage = 1;
            loadDatabaseTransactions();
        }

        function changePage(direction) {
            adminCurrentPage += direction;
            if (adminCurrentPage < 1) adminCurrentPage = 1;
            loadDatabaseTransactions();
        }

        function reloadAllTransactions() {
            adminCurrentPage = 1;
            adminFilters = { search: '', category: '', verified: '' };
            document.getElementById('adminSearchText').value = '';
            document.getElementById('adminFilterCategory').value = '';
            document.getElementById('adminFilterVerified').value = '';
            loadDatabaseTransactions();
        }

        async function resetDatabase() {
            if (!confirm('⚠️ ATTENZIONE!\n\nSei sicuro di voler cancellare TUTTE le transazioni dal database?\n\nQuesta operazione NON può essere annullata!')) {
                return;
            }
            
            if (!confirm('🚨 ULTIMA CONFERMA\n\nStai per eliminare definitivamente tutto il database.\n\nConfermi?')) {
                return;
            }
            
            try {
                showMessage('Eliminazione database in corso...', 'info');
                
                // Chiamo l'API per resettare il database
                const response = await apiCall('/api/transactions/reset', {
                    method: 'DELETE'
                });
                
                showMessage('Database resettato con successo!', 'success');
                
                // Reset variabili locali
                appData.transactions = [];
                appData.categories = {};
                lastUploadedFileId = null;
                lastUploadedFileName = null;
                lastFileDateRange = null; // ✅ Reset anche della memoria range
                currentDateFilter = null;
                
                // Ricarica tutte le visualizzazioni
                await updateStatsFromAPI();
                await updateTransactionsFromAPI();
                drawPieChart(); drawMiniCharts();
                
                // Pulisci la lista admin
                document.getElementById('adminTransactionsList').innerHTML = `
                    <div class="loading-initial" style="text-align: center; opacity: 0.6; padding: 40px 20px;">
                        <i data-lucide="database" style="width:48px;height:48px;margin-bottom:15px;color:#a78bfa;"></i>
                        <div>Database vuoto</div>
                        <div style="font-size: 14px; margin-top: 8px;">Carica un estratto conto per iniziare</div>
                    </div>
                `;
                
            } catch (error) {
                console.error('Errore nel reset del database:', error);
                showMessage('Errore nel reset del database', 'error');
            }
        }

        async function refreshAuthToken() {
            try {
                showMessage('Rigenerazione token...', 'info');
                
                // Rimuovi il token vecchio
                localStorage.removeItem('authToken');
                
                // Ottieni nuovo token
                const token = await ensureAuthenticated();
                
                if (token) {
                    showMessage('Token rigenerato! Ricarico dati...', 'success');
                    
                    // Ricarica tutto
                    await updateStatsFromAPI();
                    await updateTransactionsFromAPI();
                    drawPieChart(); drawMiniCharts();
                } else {
                    showMessage('Errore nella rigenerazione del token', 'error');
                }
            } catch (error) {
                console.error('Errore refresh token:', error);
                showMessage('Errore nella rigenerazione del token', 'error');
            }
        }

        // 🆕 Carica statistiche Google Places API
        async function loadGooglePlacesStats() {
            try {
                const result = await apiCall('/api/transactions/google-places-stats');
                const stats = result.data;
                
                const content = document.getElementById('googlePlacesStatsContent');
                
                if (!stats.enabled) {
                    content.innerHTML = `
                        <div style="opacity: 0.7;">
                            ⚠️ API disabilitata. Abilita in .env: <code>GOOGLE_PLACES_ENABLED=true</code>
                        </div>
                    `;
                    return;
                }
                
                const statusColor = parseFloat(stats.costs.percentUsed) > 50 ? '#f43f5e' : 'var(--accent-success)';
                
                content.innerHTML = `
                    <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 10px; margin-bottom: 10px;">
                        <div>
                            <div style="opacity: 0.7; font-size: 11px;">API Calls</div>
                            <div style="font-weight: bold; color: #667eea;">${stats.apiCalls}</div>
                        </div>
                        <div>
                            <div style="opacity: 0.7; font-size: 11px;">Cache Hits</div>
                            <div style="font-weight: bold; color: var(--accent-success);">${stats.cacheHits}</div>
                        </div>
                        <div>
                            <div style="opacity: 0.7; font-size: 11px;">Hit Rate</div>
                            <div style="font-weight: bold; color: var(--accent-success);">${stats.cacheHitRate}</div>
                        </div>
                        <div>
                            <div style="opacity: 0.7; font-size: 11px;">Errors</div>
                            <div style="font-weight: bold; color: ${stats.errors > 0 ? '#f43f5e' : 'var(--accent-success)'};">${stats.errors}</div>
                        </div>
                    </div>
                    <div style="background: rgba(255,255,255,0.1); border-radius: 8px; padding: 10px; margin-top: 10px;">
                        <div style="display: flex; justify-content: space-between; margin-bottom: 5px;">
                            <span style="opacity: 0.8; display:inline-flex;align-items:center;gap:4px;"><i data-lucide="coins" style="width:14px;height:14px;"></i> Costo stimato:</span>
                            <span style="font-weight: bold; color: ${statusColor};">$${stats.costs.totalCost}</span>
                        </div>
                        <div style="display: flex; justify-content: space-between; margin-bottom: 5px;">
                            <span style="opacity: 0.8; display:inline-flex;align-items:center;gap:4px;"><i data-lucide="pie-chart" style="width:14px;height:14px;"></i> Utilizzo soglia:</span>
                            <span style="font-weight: bold; color: ${statusColor};">${stats.costs.percentUsed} (di ${stats.costs.freeLimit})</span>
                        </div>
                        <div style="display: flex; justify-content: space-between;">
                            <span style="opacity: 0.8; display:inline-flex;align-items:center;gap:4px;"><i data-lucide="check-circle" style="width:14px;height:14px;"></i> Rimanenti gratis:</span>
                            <span style="font-weight: bold; color: var(--accent-success);">${stats.costs.remaining} chiamate</span>
                        </div>
                    </div>
                    <div style="opacity: 0.6; font-size: 11px; margin-top: 8px; text-align: center;">
                        ${stats.uptime} • Reset mensile automatico
                    </div>
                `;
                
            } catch (error) {
                console.error('Error loading Google Places stats:', error);
                document.getElementById('googlePlacesStatsContent').innerHTML = `
                    <div style="color: #f43f5e; opacity: 0.8;">
                        Errore nel caricamento statistiche
                    </div>
                `;
            }
        }

        function openAdminEditModal(transaction) {
            currentVerifyTransaction = transaction;
            document.getElementById('verifyTransactionDesc').textContent = transaction.description;
            document.getElementById('verifyTransactionDate').textContent = transaction.date;
            document.getElementById('verifyTransactionAmount').textContent = `${transaction.amount > 0 ? '+' : ''}€ ${Math.abs(transaction.amount).toFixed(2)}`;
            document.getElementById('verifyTransactionAmount').style.color = transaction.amount > 0 ? 'var(--accent-success)' : '#f43f5e';
            document.getElementById('verifyCurrentEmoji').innerHTML = `<i data-lucide="${getCategoryIcon(transaction.category)}"></i>`;
            document.getElementById('verifyCurrentCategory').textContent = transaction.category;
            document.getElementById('verifyCurrentConfidence').textContent = `Confidence: ${(transaction.confidence * 100).toFixed(0)}%`;
            
            showCategorySelector();
            document.getElementById('verifyTransactionModal').style.display = 'block';
        }

        document.addEventListener('DOMContentLoaded', async function() {
            console.log('🚀 Family Budget Tracker - Inizializzazione con backend API');

            // ✅ Nascondi tutte le tab tranne Home all'avvio
            document.querySelectorAll('.tab-content').forEach(content => {
                if (content.id !== 'homeTab') {
                    content.style.display = 'none';
                }
            });

            // ✅ NASCONDI ESPLICITAMENTE TUTTI GLI ELEMENTI DB ADMIN
            const adminFilters = document.getElementById('adminFiltersSection');
            const adminList = document.getElementById('adminTransactionsList');
            const adminPagination = document.getElementById('adminPagination');
            const dbStats = document.getElementById('dbStats');
            
            if (adminFilters) adminFilters.style.display = 'none';
            if (adminList) adminList.style.display = 'none';
            if (adminPagination) adminPagination.style.display = 'none';

            const fileInput = document.getElementById('fileInput');
            if (fileInput) {
                fileInput.addEventListener('change', function(e) {
                    if (e.target.files && e.target.files.length > 0) {
                        handleFileUpload(e.target.files);
                    }
                });
            }

            const uploadArea = document.querySelector('.upload-area');
            if (uploadArea) {
                uploadArea.addEventListener('dragover', function(e) {
                    e.preventDefault();
                    uploadArea.style.borderColor = '#00f2fe';
                    uploadArea.style.background = 'rgba(79, 172, 254, 0.2)';
                });

                uploadArea.addEventListener('dragleave', function(e) {
                    e.preventDefault();
                    uploadArea.style.borderColor = '#4facfe';
                    uploadArea.style.background = 'transparent';
                });

                uploadArea.addEventListener('drop', function(e) {
                    e.preventDefault();
                    uploadArea.style.borderColor = '#4facfe';
                    uploadArea.style.background = 'transparent';
                    if (e.dataTransfer.files.length > 0) {
                        handleFileUpload(e.dataTransfer.files);
                    }
                });
            }

            // --- Live Search DB Admin ---
            const adminSearchInput = document.getElementById('adminSearchText');
            const adminCategorySelect = document.getElementById('adminFilterCategory');
            const adminVerifiedSelect = document.getElementById('adminFilterVerified');

            const debounceAdmin = (func, delay) => {
                let timeout;
                return (...args) => {
                    clearTimeout(timeout);
                    timeout = setTimeout(() => func(...args), delay);
                };
            };

            const triggerAdminRefresh = debounceAdmin(() => {
                applyAdminFilters();
            }, 300);

            if (adminSearchInput) {
                adminSearchInput.addEventListener('input', triggerAdminRefresh);
            }
            if (adminCategorySelect) {
                adminCategorySelect.addEventListener('change', () => {
                    applyAdminFilters();
                });
            }
            if (adminVerifiedSelect) {
                adminVerifiedSelect.addEventListener('change', () => {
                    applyAdminFilters();
                });
            }

            const canvas = document.getElementById('pieChart');
            canvas.addEventListener('click', function(event) {
                if (pieChartSlices.length === 0) return;

                const rect = canvas.getBoundingClientRect();
                const x = event.clientX - rect.left;
                const y = event.clientY - rect.top;

                const centerX = canvas.width / 2;
                const centerY = canvas.height / 2;

                const dx = x - centerX;
                const dy = y - centerY;
                const distance = Math.sqrt(dx * dx + dy * dy);
                
                if (distance > 100) return;

                let angle = Math.atan2(dy, dx);
                angle = angle + Math.PI / 2;
                if (angle < 0) angle += 2 * Math.PI;

                for (let slice of pieChartSlices) {
                    let start = slice.startAngle;
                    let end = slice.endAngle;
                    
                    if (start < 0) start += 2 * Math.PI;
                    if (end < 0) end += 2 * Math.PI;
                    
                    if (end < start) {
                        if (angle >= start || angle <= end) {
                            showCategoryDetails(slice.categoryName);
                            return;
                        }
                    } else {
                        if (angle >= start && angle <= end) {
                            showCategoryDetails(slice.categoryName);
                            return;
                        }
                    }
                }
            });

            canvas.addEventListener('mousemove', function(event) {
                if (pieChartSlices.length === 0) return;

                const rect = canvas.getBoundingClientRect();
                const x = event.clientX - rect.left;
                const y = event.clientY - rect.top;

                const centerX = canvas.width / 2;
                const centerY = canvas.height / 2;

                const dx = x - centerX;
                const dy = y - centerY;
                const distance = Math.sqrt(dx * dx + dy * dy);
                
                if (distance <= 100) {
                    canvas.style.opacity = '0.9';
                } else {
                    canvas.style.opacity = '1';
                }
            });

            canvas.addEventListener('mouseleave', function() {
                canvas.style.opacity = '1';
            });

            const today = new Date();
            const oneMonthAgo = new Date(today);
            oneMonthAgo.setMonth(oneMonthAgo.getMonth() - 1);
            
            document.getElementById('dateTo').value = today.toISOString().split('T')[0];
            document.getElementById('dateFrom').value = oneMonthAgo.toISOString().split('T')[0];

            currentDateFilter = {
                from: document.getElementById('dateFrom').value,
                to: document.getElementById('dateTo').value
            };

            try {
                await ensureAuthenticated();
                
                document.getElementById('authScreen').style.display = 'none';
                document.getElementById('appContainer').style.display = 'block';
                document.getElementById('appTabBar').style.display = 'flex';
                document.getElementById('miniProfile').style.display = 'block';

                await initializeApplicationData();
            } catch (error) {
                console.error('Errore inizializzazione flow auth:', error);
            }
        });

        async function initializeApplicationData() {
            try {
                console.log('✅ Caricamento dati iniziali post-login');
                
                // Fetch principali per popolare la dashboard
                if (typeof updateStatsFromAPI === 'function') await updateStatsFromAPI();
                if (typeof updateTransactionsFromAPI === 'function') await updateTransactionsFromAPI();
                
                if (typeof loadTravels === 'function') {
                    loadTravels();
                }

                // Draw mini charts on home after data loads
                setTimeout(() => { if (typeof drawMiniCharts === 'function') drawMiniCharts(); }, 100);

                // Start periodic coin bursts from the pig
                startCoinBursts();
            } catch (error) {
                console.error('Errore inizializzazione dati:', error);
                showMessage('Errore durante il caricamento dei dati.', 'error');
            }
        }

        console.log('🎯 Family Budget Tracker caricato - Pronto per parsing REALE con backend API!');

        // --- INIZIO LOGICA TAB ANALISI ---
        let analysisChartInstance = null;

        // --- ANALISI MENSILE ---
        let analysisMonthlyData = [];    // all months from API
        let analysisCurrentIndex = -1;  // currently displayed month index
        let analysisOverviewChartInst = null;
        let analysisCategoryChartInst = null;

        const CATEGORY_COLORS = [
            'rgba(110, 231, 183, 0.85)', // Emerald
            'rgba(99, 102, 241, 0.85)',  // Indigo
            'rgba(244, 63, 94, 0.85)',   // Rose
            'rgba(251, 191, 36, 0.85)',  // Amber
            'rgba(14, 165, 233, 0.85)',  // Sky
            'rgba(217, 70, 239, 0.85)',  // Fuchsia
            'rgba(168, 85, 247, 0.85)',  // Purple
            'rgba(249, 115, 22, 0.85)',  // Orange
            'rgba(20, 184, 166, 0.85)',  // Teal
            'rgba(236, 72, 153, 0.85)',  // Pink
            'rgba(6, 182, 212, 0.85)',   // Cyan
            'rgba(132, 204, 22, 0.85)',  // Lime
        ];

        function formatMonthLabel(yyyymm) {
            const [y, m] = yyyymm.split('-');
            const d = new Date(parseInt(y), parseInt(m) - 1, 1);
            const label = d.toLocaleString('it-IT', { month: 'long', year: 'numeric' });
            return label.charAt(0).toUpperCase() + label.slice(1);
        }

        async function loadAnalysisData() {
        window.loadAnalysisData = loadAnalysisData;

            // ✅ SBLOCCO: Ora mostriamo le analisi anche se non ci sono file caricati (per Open Banking)
            document.getElementById('analysisEmptyState').style.display = 'none';

            try {
                const params = new URLSearchParams();
                // Se abbiamo un file specifico, lo mostriamo. Altrimenti se abbiamo un conto bancario sincronizzato, mostriamo solo quello.
                if (lastUploadedFileId && lastUploadedFileId !== 'null') {
                    params.append('uploadedFileId', lastUploadedFileId);
                } else if (lastBankAccountId && lastBankAccountId !== 'null') {
                    params.append('bankAccountId', lastBankAccountId);
                }
                
                if (currentDateFilter) {
                    params.append('dateFrom', currentDateFilter.from);
                    params.append('dateTo', currentDateFilter.to);
                }
                const result = await apiCall(`/api/transactions/monthly-breakdown?${params}`);
                analysisMonthlyData = result.data.months || [];

                if (analysisMonthlyData.length === 0) {
                    document.getElementById('analysisContent').style.display = 'none';
                    document.getElementById('analysisEmptyState').style.display = 'block';
                    return;
                }

                document.getElementById('analysisContent').style.display = 'block';
                document.getElementById('analysisEmptyState').style.display = 'none';

                // Default to latest month
                analysisCurrentIndex = analysisMonthlyData.length - 1;

                renderOverviewChart();
                renderCurrentMonth();
            } catch (err) {
                console.error('Errore analysis:', err);
            }
        }

        function analysisNavMonth(delta) {
            if (analysisMonthlyData.length === 0) return;
            analysisCurrentIndex = Math.max(0, Math.min(analysisMonthlyData.length - 1, analysisCurrentIndex + delta));
            renderCurrentMonth();
        }

        function renderCurrentMonth() {
            if (analysisCurrentIndex < 0 || !analysisMonthlyData[analysisCurrentIndex]) return;
            const m = analysisMonthlyData[analysisCurrentIndex];
            const label = formatMonthLabel(m.month);

            document.getElementById('analysisMonthLabel').textContent = label;
            document.getElementById('analysisCategoryMonthLabel').textContent = label;
            document.getElementById('analysisIncome').textContent = formatAmount(m.income);
            document.getElementById('analysisExpenses').textContent = formatAmount(m.expenses);
            const bal = m.balance;
            const balEl = document.getElementById('analysisBalance');
            balEl.textContent = formatAmount(bal);
            balEl.style.color = bal >= 0 ? 'var(--accent-success)' : '#f43f5e';

            renderCategoryBarChart(m);

            // Highlight current bar on overview chart
            if (analysisOverviewChartInst) {
                const total = analysisMonthlyData.length;
                const incomeColors = analysisMonthlyData.map((_, i) => {
                    const baseColor = isDarkMode() ? '16, 185, 129' : '5, 150, 105';
                    return i === analysisCurrentIndex ? `rgba(${baseColor}, 1)` : `rgba(${baseColor}, 0.35)`;
                });
                const expenseColors = analysisMonthlyData.map((_, i) =>
                    i === analysisCurrentIndex ? 'rgba(244, 63, 94, 1)' : 'rgba(244, 63, 94, 0.35)'
                );
                analysisOverviewChartInst.data.datasets[0].backgroundColor = incomeColors;
                analysisOverviewChartInst.data.datasets[1].backgroundColor = expenseColors;
                analysisOverviewChartInst.update();
            }
        }

        function renderOverviewChart() {
            const canvas = document.getElementById('analysisOverviewChart');
            if (!canvas) return;
            if (analysisOverviewChartInst) analysisOverviewChartInst.destroy();

            Chart.defaults.color = isDarkMode() ? '#94a3b8' : '#1e293b';
            Chart.defaults.font.family = "'Inter', sans-serif";

            const gridColor = isDarkMode() ? 'rgba(255,255,255,0.04)' : 'rgba(15, 23, 42, 0.1)';
            const tooltipBg = isDarkMode() ? 'rgba(12,14,22,0.95)' : 'rgba(255,255,255,0.95)';
            const tooltipBorder = isDarkMode() ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.1)';

            const labels = analysisMonthlyData.map(m => {
                const [y, mo] = m.month.split('-');
                return new Date(parseInt(y), parseInt(mo)-1, 1).toLocaleString('it-IT', { month: 'short'}).toUpperCase() + ' ' + y;
            });

            analysisOverviewChartInst = new Chart(canvas, {
                type: 'bar',
                data: {
                    labels,
                    datasets: [
                        {
                            label: 'Entrate',
                            data: analysisMonthlyData.map(m => m.income),
                            backgroundColor: analysisMonthlyData.map(() => {
                                const baseColor = isDarkMode() ? '16, 185, 129' : '5, 150, 105';
                                return `rgba(${baseColor}, 0.35)`;
                            }),
                            borderRadius: 6,
                            borderSkipped: false
                        },
                        {
                            label: 'Uscite',
                            data: analysisMonthlyData.map(m => m.expenses),
                            backgroundColor: analysisMonthlyData.map(() => 'rgba(244, 63, 94, 0.35)'),
                            borderRadius: 6,
                            borderSkipped: false
                        }
                    ]
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    interaction: { mode: 'index', intersect: false },
                    onClick: (e, elements) => {
                        if (elements.length > 0) {
                            analysisCurrentIndex = elements[0].index;
                            renderCurrentMonth();
                        }
                    },
                    plugins: {
                        legend: { 
                            position: 'top', 
                            labels: { 
                                usePointStyle: true, 
                                padding: 16, 
                                font: { size: 12 },
                                color: Chart.defaults.color
                            } 
                        },
                        tooltip: {
                            backgroundColor: tooltipBg,
                            borderColor: tooltipBorder,
                            borderWidth: 1,
                            titleColor: isDarkMode() ? '#fff' : '#000',
                            bodyColor: isDarkMode() ? '#fff' : '#000',
                            callbacks: { label: ctx => `${ctx.dataset.label}: ${formatAmount(ctx.parsed.y)}` }
                        }
                    },
                    scales: {
                        x: { grid: { color: gridColor }, ticks: { color: Chart.defaults.color } },
                        y: { 
                            grid: { color: gridColor }, 
                            ticks: { 
                                color: Chart.defaults.color,
                                callback: v => formatAmount(v) 
                            } 
                        }
                    }
                }
            });
        }

        function renderCategoryBarChart(monthData) {
            const canvas = document.getElementById('analysisCategoryChart');
            if (!canvas) return;
            if (analysisCategoryChartInst) analysisCategoryChartInst.destroy();

            const categories = monthData.categories.slice(0, 15); // Show top 15
            
            Chart.defaults.color = isDarkMode() ? '#94a3b8' : '#1e293b';
            Chart.defaults.font.family = "'Inter', sans-serif";

            const gridColor = isDarkMode() ? 'rgba(255,255,255,0.04)' : 'rgba(15, 23, 42, 0.08)';
            const tooltipBg = isDarkMode() ? 'rgba(12,14,22,0.95)' : 'rgba(255,255,255,0.95)';
            const tooltipBorder = isDarkMode() ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.1)';

            analysisCategoryChartInst = new Chart(canvas, {
                type: 'bar',
                data: {
                    labels: categories.map(c => c.name),
                    datasets: [{
                        label: 'Spesa',
                        data: categories.map(c => c.amount),
                        backgroundColor: categories.map(c => c.color || '#6366f1'),
                        borderRadius: { topLeft: 10, topRight: 10, bottomLeft: 0, bottomRight: 0 },
                        borderSkipped: false
                    }]
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    plugins: {
                        legend: { display: false },
                        tooltip: {
                            backgroundColor: tooltipBg,
                            borderColor: tooltipBorder,
                            borderWidth: 1,
                            titleColor: isDarkMode() ? '#fff' : '#000',
                            bodyColor: isDarkMode() ? '#fff' : '#000',
                            callbacks: { 
                                label: ctx => ` ${formatAmount(ctx.parsed.y)}` 
                            }
                        }
                    },
                    onClick: (event, elements) => {
                        if (elements.length > 0) {
                            const index = elements[0].index;
                            const categoryName = categories[index].name;
                            showCategoryDetails(categoryName);
                        }
                    },
                    scales: {
                        x: { 
                            grid: { display: false }, 
                            ticks: { 
                                color: Chart.defaults.color,
                                maxRotation: 45,
                                minRotation: 45,
                                font: { size: 11, weight: '500' }
                            } 
                        },
                        y: { 
                            grid: { color: gridColor }, 
                            ticks: { 
                                color: Chart.defaults.color,
                                callback: v => formatAmount(v) 
                            } 
                        }
                    }
                }
            });
        }

        // --- LOGICA PROFILO & AVATAR ---
        function toggleProfileDropdown(event) {
            event.stopPropagation();
            const dropdown = document.getElementById('profileDropdown');
            dropdown.classList.toggle('active');
            
            // Chiudi se si clicca fuori
            if (dropdown.classList.contains('active')) {
                const closeHandler = () => {
                    dropdown.classList.remove('active');
                    document.removeEventListener('click', closeHandler);
                };
                setTimeout(() => document.addEventListener('click', closeHandler), 10);
            }
        }

        function openAvatarModal(event) {
            if (event) event.stopPropagation();
            document.getElementById('miniProfilePanel')?.classList.remove('open');
            
            const modal = document.getElementById('avatarModal');
            const grid = document.getElementById('avatarGrid');
            
            const avatars = [
                { id: 'pirate', name: 'Pirata' },
                { id: 'pilot', name: 'Pilota' },
                { id: 'astronaut', name: 'Astronauta' },
                { id: 'ninja', name: 'Ninja' },
                { id: 'wizard', name: 'Mago' },
                { id: 'chef', name: 'Chef' },
                { id: 'superhero', name: 'Eroe' },
                { id: 'king', name: 'Re' },
                { id: 'detective', name: 'Detective' },
                { id: 'cyberpunk', name: 'Cyber' }
            ];

            grid.innerHTML = avatars.map(av => `
                <div class="avatar-option ${currentUser.avatar === av.id ? 'selected' : ''}" onclick="selectAvatar('${av.id}')">
                    <img src="img/avatars/${av.id}.png" alt="${av.name}">
                </div>
            `).join('');

            // Aggiungi pulsante upload custom
            grid.innerHTML += `
                <div class="avatar-upload-btn" onclick="document.getElementById('customAvatarInput').click()">
                    <i data-lucide="plus" style="width:32px; height:32px;"></i>
                    <div style="font-size:12px; font-weight:600;">Carica Foto</div>
                </div>
            `;

            modal.style.display = 'flex';
            setTimeout(refreshIcons, 10);
        }

        function closeAvatarModal() {
            document.getElementById('avatarModal').style.display = 'none';
        }

        async function selectAvatar(avatarId) {
            try {
                const result = await apiCall('/api/auth/profile/avatar', {
                    method: 'POST',
                    body: JSON.stringify({ avatar: avatarId })
                });

                if (result.success) {
                    currentUser.avatar = avatarId;
                    updateUserDisplay();
                    closeAvatarModal();
                    showMessage('Avatar aggiornato!', 'success');
                }
            } catch (error) {
                console.error('Error selecting avatar:', error);
                showMessage('Errore nel cambio avatar', 'error');
            }
        }

        async function handleCustomAvatarUpload(input) {
            if (!input.files || !input.files[0]) return;
            
            const formData = new FormData();
            formData.append('avatar', input.files[0]);

            try {
                const token = getAuthToken();
                const response = await fetch('/api/auth/profile/avatar', {
                    method: 'POST',
                    headers: { 'Authorization': `Bearer ${token}` },
                    body: formData
                });

                const result = await response.json();
                if (result.success) {
                    currentUser.avatar = result.user.avatar;
                    updateUserDisplay();
                    closeAvatarModal();
                    showMessage('Foto profilo caricata!', 'success');
                } else {
                    showMessage(result.error || 'Errore nel caricamento', 'error');
                }
            } catch (error) {
                console.error('Error uploading custom avatar:', error);
                showMessage('Errore di connessione', 'error');
            }
            input.value = ''; // Reset input
        }

        // --- VIEW MODE EMULATOR (Desktop/Mobile) ---
        async function setViewMode(mode) {
            console.log(`Switching view mode to: ${mode}`);
            const body = document.body;
            const desktopBtn = document.getElementById('viewDesktopBtn');
            const mobileBtn = document.getElementById('viewMobileBtn');

            if (mode === 'mobile') {
                body.classList.add('is-mobile-emulated');
                if (mobileBtn) mobileBtn.classList.add('active');
                if (desktopBtn) desktopBtn.classList.remove('active');
                localStorage.setItem('preferredViewMode', 'mobile');
            } else {
                body.classList.remove('is-mobile-emulated');
                if (desktopBtn) desktopBtn.classList.add('active');
                if (mobileBtn) mobileBtn.classList.remove('active');
                localStorage.setItem('preferredViewMode', 'desktop');
            }
            
            // Re-render icons for consistency
            if (typeof lucide !== 'undefined') lucide.createIcons();
            
            // Small delay to ensure layout shifts are done before re-rendering charts
            setTimeout(() => {
                if (typeof window.drawPieChart === 'function') { window.drawPieChart(); drawMiniCharts(); }
            }, 300);
        }
        window.setViewMode = setViewMode;

        // Inizializzazione al caricamento
        document.addEventListener('DOMContentLoaded', () => {
            const savedMode = localStorage.getItem('preferredViewMode');
            if (savedMode === 'mobile') {
                setTimeout(() => setViewMode('mobile'), 500);
            }

            // Status bar clock
            function updateStatusBarTime() {
                const el = document.getElementById('psbTime');
                if (!el) return;
                const now = new Date();
                el.textContent = now.getHours() + ':' + String(now.getMinutes()).padStart(2, '0');
            }
            updateStatusBarTime();
            setInterval(updateStatusBarTime, 30000);
        });
