pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.4.120/pdf.worker.min.js';

        // --- STATE (preserved logic) ---
        let pdfDoc = null, currentPage = 1, totalPages = 0;
        let currentPdfId = "default_text_mode";
        let currentPdfName = "📝 Pasted Text";
        let extractedText = "";
        let noteVault = {}, listenVault = [];

        let currentUtterance = null, isReadingActive = false, isPaused = false;
        let speechStartTime = 0, estimatedDurationSec = 0, animationFrameId = null;
        let originalFullText = "", wordsArray = [], currentWordIndex = 0;
        let voiceSettings = { rate: 1.0, voiceIdx: 0 };

        let mediaRecorder = null, audioChunks = [], isRecording = false, recordingStream = null, recordedAudioBlob = null;

        let speedWordsArray = [], speedCurrentIndex = 0, speedInterval = null, isSpeedPlaying = false, currentWpm = 300;

        // DOM Elements
        const uploadPdfBtn = document.getElementById('uploadPdfBtn');
        const uploadPlaceholder = document.getElementById('uploadPdfBtnPlaceholder');
        const pdfFileInput = document.createElement('input'); pdfFileInput.type = 'file'; pdfFileInput.accept = 'application/pdf';
        const pdfCanvas = document.getElementById('pdfCanvas');
        const pdfPlaceholderDiv = document.getElementById('pdfPlaceholder');
        const prevBtn = document.getElementById('prevPageBtn'), nextBtn = document.getElementById('nextPageBtn');
        const pageNumSpan = document.getElementById('pageNumInfo');
        const pdfFileNameSpan = document.getElementById('pdfFileNameDisplay');
        const textArea = document.getElementById('sourceTxt');
        const readAloudBtn = document.getElementById('readAloudBtn');
        const speedReadBtn = document.getElementById('speedReadBtn');
        const saveListenVaultBtn = document.getElementById('saveListenVaultBtn');
        const listenVaultDiv = document.getElementById('listenVaultList');
        const clearListenBtn = document.getElementById('clearListenVaultBtn');
        const rateSlider = document.getElementById('rateCtrl'), rateSpan = document.getElementById('rateVal');
        const voiceSelect = document.getElementById('voicePicker');
        const wpmSlider = document.getElementById('wpmCtrl'), wpmVal = document.getElementById('wpmVal');
        const noteInput = document.getElementById('noteInput'), saveNoteBtn = document.getElementById('saveNoteBtn');
        const noteHistoryDiv = document.getElementById('noteHistoryList');
        const clearAllNotesBtn = document.getElementById('clearAllNotesBtn');
        const exportPdfNotesBtn = document.getElementById('exportPdfNotesBtn');
        const printNotesBtn = document.getElementById('printNotesBtn');

        const overlay = document.getElementById('readingOverlay');
        const bigWordSpan = document.getElementById('bigWordDisplay');
        const boardProgress = document.getElementById('boardProgressFill');
        const playPauseBtn = document.getElementById('playPauseBoardBtn');
        const stopBtn = document.getElementById('stopBoardBtn');
        const closeBoardBtn = document.getElementById('closeBoardBtn');
        const prevWordBtn = document.getElementById('prevWordBtn'), nextWordBtn = document.getElementById('nextWordBtn');
        const progressContainer = document.getElementById('progressBarContainer');
        const takeNoteReadingBtn = document.getElementById('takeNoteWhileReadingBtn');
        const readerStatusSpan = document.getElementById('readerStatus');
        const recordBoardBtn = document.getElementById('recordBoardBtn');
        const downloadRecordingBtn = document.getElementById('downloadRecordingBtn');
        const recordingStatusSpan = document.getElementById('recordingStatus');

        const speedModal = document.getElementById('speedReadingModal');
        const speedWordDisplay = document.getElementById('speedWordDisplay');
        const speedProgressFill = document.getElementById('speedProgressFill');
        const speedPlayPauseBtn = document.getElementById('speedPlayPauseBtn');
        const speedStopBtn = document.getElementById('speedStopBtn');
        const speedPrevBtn = document.getElementById('speedPrevBtn');
        const speedNextBtn = document.getElementById('speedNextBtn');
        const decreaseWpm = document.getElementById('decreaseWpm');
        const increaseWpm = document.getElementById('increaseWpm');
        const currentWpmDisplay = document.getElementById('currentWpmDisplay');
        const takeNoteSpeedBtn = document.getElementById('takeNoteSpeedBtn');
        const closeSpeedBtn = document.getElementById('closeSpeedBtn');

        // === PDF FUNCTIONS ===
        function openPdf(file) {
            if (!file) return;
            const fileReader = new FileReader();
            fileReader.onload = async function (e) {
                const typedArray = new Uint8Array(e.target.result);
                try {
                    pdfDoc = await pdfjsLib.getDocument(typedArray).promise;
                    totalPages = pdfDoc.numPages;
                    currentPage = 1;
                    currentPdfName = file.name.replace(/\.pdf$/i, '');
                    currentPdfId = `pdf::${currentPdfName}`;
                    pdfFileNameSpan.innerText = `📄 ${currentPdfName}`;
                    if (!noteVault[currentPdfId]) noteVault[currentPdfId] = [];
                    renderNotes();
                    renderPage(currentPage);
                    let fullText = "";
                    for (let i = 1; i <= totalPages; i++) {
                        const page = await pdfDoc.getPage(i);
                        const content = await page.getTextContent();
                        fullText += content.items.map(t => t.str).join(" ") + " ";
                    }
                    extractedText = fullText.trim() || "No extractable text.";
                    textArea.value = extractedText;
                    updateTextForReading(extractedText);
                    pdfPlaceholderDiv.style.display = 'none';
                    pdfCanvas.style.display = 'block';
                } catch (err) { alert("PDF error: " + err.message); }
            };
            fileReader.readAsArrayBuffer(file);
        }

        function renderPage(num) {
            if (!pdfDoc) return;
            pdfDoc.getPage(num).then(page => {
                const viewport = page.getViewport({ scale: 1.5 });
                const ctx = pdfCanvas.getContext('2d');
                pdfCanvas.height = viewport.height;
                pdfCanvas.width = viewport.width;
                page.render({ canvasContext: ctx, viewport: viewport });
                pageNumSpan.innerText = `Page ${num} / ${totalPages}`;
            });
        }

        function changePage(delta) { let np = currentPage + delta; if (np >= 1 && np <= totalPages) { currentPage = np; renderPage(currentPage); } }
        
        pdfFileInput.onchange = (e) => { if (e.target.files[0]) openPdf(e.target.files[0]); };
        uploadPdfBtn.onclick = () => pdfFileInput.click();
        if (uploadPlaceholder) uploadPlaceholder.onclick = () => pdfFileInput.click();
        prevBtn.onclick = () => changePage(-1);
        nextBtn.onclick = () => changePage(1);

        function updateTextForReading(text) { originalFullText = text; wordsArray = text.split(/\s+/).filter(w => w.length > 0); currentWordIndex = 0; }

        // === NOTES & VAULT (persistent logic) ===
        function loadAllData() {
            const storedNotes = localStorage.getItem("hillary_notes_vault_final");
            noteVault = storedNotes ? JSON.parse(storedNotes) : {};
            const storedListen = localStorage.getItem("hillary_listen_vault_final");
            listenVault = storedListen ? JSON.parse(storedListen) : [];
            renderListenVault();
            renderNotes();
        }
        function saveNoteVault() { localStorage.setItem("hillary_notes_vault_final", JSON.stringify(noteVault)); renderNotes(); }
        function saveListenVault() { localStorage.setItem("hillary_listen_vault_final", JSON.stringify(listenVault)); renderListenVault(); }
        
        function renderNotes() {
            const notes = noteVault[currentPdfId] || [];
            if (!noteHistoryDiv) return;
            if (notes.length === 0) { noteHistoryDiv.innerHTML = '<div style="color:#64748B; text-align:center; padding:20px;">✨ No notes yet</div>'; return; }
            noteHistoryDiv.innerHTML = '';
            notes.forEach((note, idx) => {
                const div = document.createElement('div');
                div.className = 'note-item';
                div.innerHTML = `<div style="display:flex; align-items:center; gap:8px; margin-bottom:6px;"><input type="checkbox" class="note-check" data-id="${note.id}" ${note.completed ? 'checked' : ''}><span style="font-size:0.7rem; opacity:0.6;">#${idx + 1}</span></div><div class="note-content" data-id="${note.id}">${escapeHtml(note.text)}</div><div><button class="note-btn-small edit-note" data-id="${note.id}">Edit</button><button class="note-btn-small delete-note" data-id="${note.id}">Delete</button></div>`;
                noteHistoryDiv.appendChild(div);
            });
            attachNoteEvents();
        }
        
        function attachNoteEvents() {
            document.querySelectorAll('.note-check').forEach(cb => cb.onclick = (e) => { const id = cb.dataset.id; const n = (noteVault[currentPdfId] || []).find(n => n.id === id); if (n) { n.completed = cb.checked; saveNoteVault(); } e.stopPropagation(); });
            document.querySelectorAll('.edit-note').forEach(btn => btn.onclick = (e) => { const id = btn.dataset.id; const n = (noteVault[currentPdfId] || []).find(n => n.id === id); if (n) openEditModal(n); e.stopPropagation(); });
            document.querySelectorAll('.delete-note').forEach(btn => btn.onclick = (e) => { if (confirm("Delete?")) { noteVault[currentPdfId] = (noteVault[currentPdfId] || []).filter(n => n.id !== btn.dataset.id); saveNoteVault(); } e.stopPropagation(); });
        }
        
        function openEditModal(note) { const modal = document.createElement('div'); modal.className = 'modal-overlay'; modal.innerHTML = `<div class="modal-content"><h3 style="margin-bottom:16px;">✏️ Edit Note</h3><textarea id="editText">${note.text.replace(/</g, '&lt;')}</textarea><div style="margin-top:16px;"><button class="modal-btn modal-cancel">Cancel</button><button class="modal-btn modal-save">Save</button></div></div>`; document.body.appendChild(modal); const ta = modal.querySelector('#editText'); modal.querySelector('.modal-save').onclick = () => { if (ta.value.trim()) { note.text = ta.value.trim(); saveNoteVault(); } modal.remove(); }; modal.querySelector('.modal-cancel').onclick = () => modal.remove(); }
        function addNote(content) { if (!content.trim()) return; if (!noteVault[currentPdfId]) noteVault[currentPdfId] = []; noteVault[currentPdfId].push({ id: Date.now() + '-' + Math.random(), text: content.trim(), completed: false }); saveNoteVault(); noteInput.value = ''; }
        function clearAllNotesFunc() { if (confirm("Delete all notes?")) { noteVault[currentPdfId] = []; saveNoteVault(); } }
        function printNotes() { const notes = noteVault[currentPdfId] || []; if (notes.length === 0) { alert("No notes."); return; } const win = window.open('', '_blank'); let html = `<html><head><title>Notes</title><style>body{font-family:sans-serif;padding:30px;}</style></head><body><h1>${currentPdfName}</h1><p>${new Date()}</p>`; notes.forEach((n, i) => { html += `<div style="border-left:4px solid ${n.completed ? '#10B981' : '#F59E0B'}; margin-bottom:20px; padding-left:15px;"><strong>${n.completed ? '✅' : '⬜'} Note ${i + 1}</strong><div>${escapeHtml(n.text)}</div></div>`; }); html += `<script>window.onload=()=>{window.print();setTimeout(()=>window.close(),500);};<\/script></body></html>`; win.document.write(html); win.document.close(); }
        function exportAsPdf() { const notes = noteVault[currentPdfId] || []; if (notes.length === 0) { alert("No notes"); return; } const { jsPDF } = window.jspdf; const doc = new jsPDF(); doc.setFillColor(15, 23, 42); doc.rect(0, 0, 210, 297, 'F'); doc.setTextColor(129, 140, 248); doc.setFontSize(18); doc.text(`Notes: ${currentPdfName.substring(0, 40)}`, 20, 25); doc.setFontSize(10); doc.setTextColor(245, 158, 11); doc.text(`Exported: ${new Date().toLocaleString()}`, 20, 40); let y = 60; notes.forEach((n, i) => { if (y > 270) { doc.addPage(); y = 20; doc.setFillColor(15, 23, 42); doc.rect(0, 0, 210, 297, 'F'); } doc.setTextColor(245, 158, 11); doc.text(`${n.completed ? '✓' : '○'} Note ${i + 1}`, 20, y); y += 6; doc.setTextColor(226, 232, 240); const lines = doc.splitTextToSize(n.text, 170); doc.text(lines, 20, y); y += (lines.length * 5.5) + 12; }); doc.save(`${currentPdfName.replace(/[^a-z0-9]/gi, '_')}_notes.pdf`); }
        
        function renderListenVault() { 
            if (!listenVaultDiv) return; 
            if (listenVault.length === 0) { listenVaultDiv.innerHTML = '<div style="text-align:center; color:#64748B; padding:20px;">📭 Empty vault</div>'; return; } 
            listenVaultDiv.innerHTML = ''; 
            [...listenVault].reverse().forEach(book => { 
                const div = document.createElement('div'); 
                div.className = 'audio-card'; 
                div.innerHTML = `<div><strong>${escapeHtml(book.title)}</strong><br><small style="opacity:0.6;">${new Date(book.timestamp).toLocaleString()}</small></div><div><button class="icon-sm listen-book" data-id="${book.id}"><i class="fas fa-play"></i></button><button class="icon-sm delete-listen" data-id="${book.id}"><i class="fas fa-trash"></i></button></div>`; 
                listenVaultDiv.appendChild(div); 
            }); 
            document.querySelectorAll('.listen-book').forEach(btn => { btn.onclick = (e) => { e.stopPropagation(); const found = listenVault.find(v => v.id === btn.dataset.id); if (found) { textArea.value = found.text; updateTextForReading(found.text); alert(`✅ Loaded "${found.title}"`); } }; });
            document.querySelectorAll('.delete-listen').forEach(btn => { btn.onclick = (e) => { e.stopPropagation(); if (confirm("Delete?")) { listenVault = listenVault.filter(v => v.id !== btn.dataset.id); saveListenVault(); } }; });
        }
        function saveToListenVault() { const txt = textArea.value.trim(); if (!txt) { alert("No text"); return; } listenVault.push({ id: Date.now() + '-' + Math.random(), title: txt.substring(0, 45) + (txt.length > 45 ? "…" : ""), text: txt, timestamp: Date.now() }); saveListenVault(); alert("Saved to Vault!"); }
        function clearListenVaultAll() { if (confirm("Clear vault?")) { listenVault = []; saveListenVault(); } }

        // === READ ALOUD ===
        function loadVoices() { const voices = speechSynthesis.getVoices(); if (!voices.length) return; voiceSelect.innerHTML = ''; voices.forEach((v, idx) => { let opt = document.createElement('option'); opt.value = idx; opt.textContent = `${v.name} (${v.lang})`; voiceSelect.appendChild(opt); }); }
        speechSynthesis.onvoiceschanged = loadVoices; loadVoices();
        rateSlider.oninput = () => { rateSpan.innerText = rateSlider.value + 'x'; voiceSettings.rate = parseFloat(rateSlider.value); };
        voiceSelect.onchange = () => { voiceSettings.voiceIdx = parseInt(voiceSelect.value); };
        
        function restartFromWordIndex(idx) { if (!originalFullText) return; if (currentUtterance) speechSynthesis.cancel(); if (animationFrameId) cancelAnimationFrame(animationFrameId); const safeIdx = Math.min(Math.max(0, idx), wordsArray.length - 1); currentWordIndex = safeIdx; const sliced = wordsArray.slice(safeIdx).join(" "); estimatedDurationSec = (wordsArray.slice(safeIdx).length * 0.35) / voiceSettings.rate; const utter = new SpeechSynthesisUtterance(sliced); utter.rate = voiceSettings.rate; const voices = speechSynthesis.getVoices(); if (voices[voiceSettings.voiceIdx]) utter.voice = voices[voiceSettings.voiceIdx]; utter.onstart = () => { isReadingActive = true; isPaused = false; speechStartTime = Date.now(); boardProgress.style.width = "0%"; playPauseBtn.innerHTML = '<i class="fas fa-pause"></i>'; readerStatusSpan.innerText = "🔊 Reading..."; updateProgress(); if (wordsArray[safeIdx]) bigWordSpan.innerText = wordsArray[safeIdx]; }; utter.onboundary = (e) => { if (e.name === 'word' && isReadingActive && !isPaused) { const prefix = sliced.substring(0, e.charIndex); const rel = prefix.split(/\s+/).filter(w => w.length).length; const abs = safeIdx + rel; if (abs >= 0 && abs < wordsArray.length) { currentWordIndex = abs; bigWordSpan.innerText = wordsArray[abs]; } } }; utter.onend = () => { isReadingActive = false; playPauseBtn.innerHTML = '<i class="fas fa-play"></i>'; boardProgress.style.width = "100%"; currentUtterance = null; bigWordSpan.innerText = "🎉 Complete"; readerStatusSpan.innerText = "✅ Complete"; stopRecordingIfActive(); }; currentUtterance = utter; speechSynthesis.cancel(); speechSynthesis.speak(utter); }
        
        function updateProgress() { if (animationFrameId) cancelAnimationFrame(animationFrameId); function anim() { if (!isReadingActive || isPaused) { if (isReadingActive === false) return; animationFrameId = requestAnimationFrame(anim); return; } const elapsed = (Date.now() - speechStartTime) / 1000; let percent = Math.min((elapsed / estimatedDurationSec) * 100, 100); boardProgress.style.width = percent + "%"; animationFrameId = requestAnimationFrame(anim); } anim(); }
        function startReadAloud() { const txt = textArea.value.trim(); if (!txt) { alert("No text to read."); return; } if (currentUtterance) speechSynthesis.cancel(); updateTextForReading(txt); overlay.classList.remove('hidden'); restartFromWordIndex(0); }
        function pauseAndTakeNote() { if (!isReadingActive && !isPaused) { alert("Start reading first"); return; } if (isReadingActive && !isPaused) { speechSynthesis.pause(); isPaused = true; playPauseBtn.innerHTML = '<i class="fas fa-play"></i>'; readerStatusSpan.innerText = "⏸ Paused"; } const currentWord = bigWordSpan.innerText.includes("Ready") ? "reading" : bigWordSpan.innerText; const note = prompt(`📝 Note at: "${currentWord}"`); if (note && note.trim()) addNote(`[🔊 "${currentWord}"] ${note}`); }

        // === RECORDING ===
        async function startRecording() { if (isRecording) return; if (!isReadingActive) { alert("Please start reading aloud first"); return; } try { const stream = await navigator.mediaDevices.getUserMedia({ audio: true }); recordingStream = stream; mediaRecorder = new MediaRecorder(stream); audioChunks = []; mediaRecorder.ondataavailable = (event) => { if (event.data.size > 0) audioChunks.push(event.data); }; mediaRecorder.onstop = () => { if (audioChunks.length > 0) { recordedAudioBlob = new Blob(audioChunks, { type: 'audio/wav' }); recordingStatusSpan.innerHTML = '<i class="fas fa-check-circle"></i> Recording saved!'; recordingStatusSpan.style.color = "#34D399"; } if (recordingStream) recordingStream.getTracks().forEach(track => track.stop()); recordingStream = null; }; mediaRecorder.start(); isRecording = true; recordBoardBtn.classList.add('recording-active'); recordBoardBtn.innerHTML = '<i class="fas fa-stop"></i>'; recordingStatusSpan.innerHTML = '<span class="recording-dot"></span> RECORDING...'; recordingStatusSpan.style.color = "#F87171"; } catch (err) { alert("Microphone access required: " + err.message); } }
        function stopRecording() { if (mediaRecorder && mediaRecorder.state === 'recording') { mediaRecorder.stop(); isRecording = false; recordBoardBtn.classList.remove('recording-active'); recordBoardBtn.innerHTML = '<i class="fas fa-microphone"></i>'; } }
        function stopRecordingIfActive() { if (isRecording) stopRecording(); }
        function downloadRecordedAudio() { if (!recordedAudioBlob) { alert("No recording available. Click the microphone button to record while reading."); return; } const url = URL.createObjectURL(recordedAudioBlob); const a = document.createElement('a'); a.href = url; a.download = `audiobook_${currentPdfName.replace(/[^a-z0-9]/gi, '_')}_${new Date().toISOString().slice(0,19)}.wav`; document.body.appendChild(a); a.click(); document.body.removeChild(a); URL.revokeObjectURL(url); recordingStatusSpan.innerHTML = '<i class="fas fa-download"></i> Audio downloaded!'; setTimeout(() => { if (!isRecording) recordingStatusSpan.innerHTML = ''; }, 3000); }

        // === SPEED READING ===
        function initSpeedReading() { const txt = textArea.value.trim(); if (!txt) { alert("No text for speed reading."); return; } speedWordsArray = txt.split(/\s+/).filter(w => w.length); speedCurrentIndex = 0; if (speedInterval) clearInterval(speedInterval); isSpeedPlaying = false; speedPlayPauseBtn.innerHTML = '<i class="fas fa-play"></i> Start'; speedWordDisplay.innerHTML = speedWordsArray[0] || "⚡ Ready"; speedProgressFill.style.width = "0%"; speedModal.classList.remove('hidden'); }
        function updateSpeedWord() { if (speedCurrentIndex >= speedWordsArray.length) { stopSpeedReading(); speedWordDisplay.innerHTML = "🎉 Complete!"; return; } speedWordDisplay.innerHTML = speedWordsArray[speedCurrentIndex]; const progress = (speedCurrentIndex / speedWordsArray.length) * 100; speedProgressFill.style.width = progress + "%"; }
        function startSpeedPlayback() { if (speedInterval) clearInterval(speedInterval); if (speedCurrentIndex >= speedWordsArray.length) { speedCurrentIndex = 0; updateSpeedWord(); } const intervalMs = 60000 / currentWpm; speedInterval = setInterval(() => { if (isSpeedPlaying) { speedCurrentIndex++; if (speedCurrentIndex >= speedWordsArray.length) { stopSpeedReading(); speedWordDisplay.innerHTML = "🎉 Complete!"; } else { updateSpeedWord(); } } }, intervalMs); isSpeedPlaying = true; speedPlayPauseBtn.innerHTML = '<i class="fas fa-pause"></i> Pause'; }
        function pauseSpeedPlayback() { if (speedInterval) clearInterval(speedInterval); speedInterval = null; isSpeedPlaying = false; speedPlayPauseBtn.innerHTML = '<i class="fas fa-play"></i> Start'; }
        function stopSpeedReading() { if (speedInterval) clearInterval(speedInterval); speedInterval = null; isSpeedPlaying = false; speedPlayPauseBtn.innerHTML = '<i class="fas fa-play"></i> Start'; speedCurrentIndex = 0; updateSpeedWord(); }
        function speedPrev() { if (speedCurrentIndex > 0) { speedCurrentIndex--; updateSpeedWord(); if (isSpeedPlaying) { pauseSpeedPlayback(); startSpeedPlayback(); } } }
        function speedNext() { if (speedCurrentIndex < speedWordsArray.length - 1) { speedCurrentIndex++; updateSpeedWord(); if (isSpeedPlaying) { pauseSpeedPlayback(); startSpeedPlayback(); } } }
        function updateWpm(value) { currentWpm = Math.min(800, Math.max(100, value)); currentWpmDisplay.innerText = currentWpm + " WPM"; wpmSlider.value = currentWpm; wpmVal.innerText = currentWpm; if (isSpeedPlaying) { pauseSpeedPlayback(); startSpeedPlayback(); } }
        function takeNoteAtSpeedWord() { const currentWord = speedWordDisplay.innerHTML; const note = prompt(`📝 Note at speed reading word: "${currentWord}"`); if (note && note.trim()) addNote(`[⚡ Speed Reading: "${currentWord}"] ${note}`); }
        function closeSpeedReader() { if (speedInterval) clearInterval(speedInterval); speedInterval = null; isSpeedPlaying = false; speedModal.classList.add('hidden'); }

        // Event bindings
        readAloudBtn.onclick = startReadAloud;
        speedReadBtn.onclick = initSpeedReading;
        saveListenVaultBtn.onclick = saveToListenVault;
        clearListenBtn.onclick = clearListenVaultAll;
        clearAllNotesBtn.onclick = clearAllNotesFunc;
        exportPdfNotesBtn.onclick = exportAsPdf;
        printNotesBtn.onclick = printNotes;
        saveNoteBtn.onclick = () => { const n = noteInput.value.trim(); if (n) addNote(n); else alert("Write a note"); };
        takeNoteReadingBtn.onclick = pauseAndTakeNote;
        recordBoardBtn.onclick = () => { if (isRecording) stopRecording(); else startRecording(); };
        downloadRecordingBtn.onclick = downloadRecordedAudio;
        playPauseBtn.onclick = () => { if (isReadingActive && !isPaused) { speechSynthesis.pause(); isPaused = true; playPauseBtn.innerHTML = '<i class="fas fa-play"></i>'; readerStatusSpan.innerText = "⏸ Paused"; } else if (isReadingActive && isPaused) { speechSynthesis.resume(); isPaused = false; playPauseBtn.innerHTML = '<i class="fas fa-pause"></i>'; readerStatusSpan.innerText = "🔊 Reading..."; speechStartTime = Date.now() - ((estimatedDurationSec * (parseFloat(boardProgress.style.width) || 0) / 100) * 1000); } else if (!isReadingActive && originalFullText) restartFromWordIndex(currentWordIndex); };
        stopBtn.onclick = () => { if (currentUtterance) speechSynthesis.cancel(); isReadingActive = false; isPaused = false; playPauseBtn.innerHTML = '<i class="fas fa-play"></i>'; readerStatusSpan.innerText = "Stopped"; stopRecordingIfActive(); };
        closeBoardBtn.onclick = () => { overlay.classList.add('hidden'); if (currentUtterance) speechSynthesis.cancel(); stopRecordingIfActive(); };
        prevWordBtn.onclick = () => { if (originalFullText && currentWordIndex > 0) { if (currentUtterance) speechSynthesis.cancel(); isReadingActive = false; currentWordIndex--; restartFromWordIndex(currentWordIndex); } };
        nextWordBtn.onclick = () => { if (originalFullText && currentWordIndex < wordsArray.length - 1) { if (currentUtterance) speechSynthesis.cancel(); isReadingActive = false; currentWordIndex++; restartFromWordIndex(currentWordIndex); } };
        progressContainer?.addEventListener('click', (e) => { if (!originalFullText || !isReadingActive) return; const rect = progressContainer.getBoundingClientRect(); let percent = (e.clientX - rect.left) / rect.width; const newIdx = Math.min(Math.floor(percent * wordsArray.length), wordsArray.length - 1); if (newIdx >= 0 && newIdx < wordsArray.length) { if (currentUtterance) speechSynthesis.cancel(); currentWordIndex = newIdx; restartFromWordIndex(currentWordIndex); } });
        
        speedPlayPauseBtn.onclick = () => { if (!speedWordsArray.length) initSpeedReading(); if (isSpeedPlaying) pauseSpeedPlayback(); else startSpeedPlayback(); };
        speedStopBtn.onclick = stopSpeedReading;
        speedPrevBtn.onclick = speedPrev;
        speedNextBtn.onclick = speedNext;
        decreaseWpm.onclick = () => updateWpm(currentWpm - 50);
        increaseWpm.onclick = () => updateWpm(currentWpm + 50);
        takeNoteSpeedBtn.onclick = takeNoteAtSpeedWord;
        closeSpeedBtn.onclick = closeSpeedReader;
        wpmSlider.oninput = () => updateWpm(parseInt(wpmSlider.value));
        
        function escapeHtml(str) { return String(str).replace(/[&<>]/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[m])); }

        loadAllData();
        if (textArea.value.trim() === "") textArea.value = "Upload a PDF or paste text. Click Read Aloud, use the microphone to record your audio book, then download it!";
        updateTextForReading(textArea.value);