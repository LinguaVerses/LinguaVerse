// **** START: ADDED v9 MODULAR IMPORTS ****
import { initializeApp } from "https://www.gstatic.com/firebasejs/9.6.1/firebase-app.js";
import { 
    getAuth, 
    onAuthStateChanged, 
    createUserWithEmailAndPassword, 
    signInWithEmailAndPassword, 
    signOut 
} from "https://www.gstatic.com/firebasejs/9.6.1/firebase-auth.js";
import { 
    getFirestore, 
    doc, 
    getDoc, 
    setDoc, 
    collection, 
    addDoc, 
    getDocs,
    Timestamp,
    query,
    where,
    updateDoc,
    deleteDoc, // **** ADDED: สำหรับ Unlike ****
    increment // **** ADDED: สำหรับปุ่ม Like ****
} from "https://www.gstatic.com/firebasejs/9.6.1/firebase-firestore.js";
// **** END: ADDED v9 MODULAR IMPORTS ****

const firebaseConfig = {
    // ... วาง Config ที่คัดลอกมาจาก Firebase Console ที่นี่ ...
    apiKey: "AIzaSyAEWniC7Ka-5a0lyBUuqhSswkNnYOd7wY4",
    authDomain: "linguaverse-novel.firebaseapp.com",
    projectId: "linguaverse-novel",
    storageBucket: "linguaverse-novel.firebasestorage.app",
    messagingSenderId: "31579058890",
    appId: "1:31579058890:web:08c8f2ab8161eaf0587a33"
};

// --- Global Variables (สำหรับ App) ---
let app, auth, db;
let currentUser = null; // เก็บข้อมูล user (auth)
let currentUserData = null; // เก็บข้อมูล user (firestore)
let currentOpenNovelId = null; // เก็บ ID นิยายที่กำลังเปิดอ่าน
let currentOpenChapterId = null; // เก็บ ID ตอนที่กำลังอ่าน
let currentOpenChapterTitle = null; // เก็บชื่อตอนที่กำลังอ่าน
let novelCache = []; // เก็บ Cache นิยายที่โหลดมา
let currentEditingNovelId = null; // สำหรับ Edit Mode
let currentEditingChapterId = null; // สำหรับ Edit Mode


// --- Run everything after the window is fully loaded ---
// (Ensures lucide and firebase scripts are ready)
window.onload = function() {
    
    // 1. Initialize Firebase
    try {
        app = initializeApp(firebaseConfig);
        auth = getAuth(app);
        db = getFirestore(app);
        console.log("Firebase initialized successfully!");
    } catch (error) {
        console.error("Firebase initialization failed:", error);
        Swal.fire('Error', 'ไม่สามารถเชื่อมต่อฐานข้อมูลได้', 'error');
        return; // หยุดการทำงานถ้า Firebase พัง
    }
    
    // 2. Initialize Lucide Icons
    try {
        lucide.createIcons();
        console.log("Lucide icons created!");
    } catch (error) {
        console.error("Lucide icon creation failed:", error);
    }

    // --- Page Navigation ---
    // (ต้องประกาศเป็น global (window.) เพื่อให้ onclick ใน HTML เรียกใช้ได้)
    window.showPage = function(pageId) {
        document.querySelectorAll('.page').forEach(page => {
            page.classList.remove('active');
        });
        const activePage = document.getElementById(pageId);
        if (activePage) {
            activePage.classList.add('active');
        }
        
        if (pageId === 'page-admin-add-novel') {
            loadNovelsForDropdown('edit-novel-select');
            setAdminNovelMode('add'); 
        }
        if (pageId === 'page-admin-add-chapter') {
            loadNovelsForDropdown('chapter-novel-select');
            loadNovelsForDropdown('edit-chapter-novel-select');
            setAdminChapterMode('add'); 
        }
        if (pageId === 'page-admin-notifications') {
            loadAdminNotifications(); 
        }
        
        // Scroll to top
        // (ต้องหาฟังก์ชัน scrollToTop ใน global scope)
        if (window.scrollToTop) window.scrollToTop();
    }

    // --- Password Toggle ---
    // (ส่วนของ Register)
    const regTogglePasswordBtn = document.getElementById('reg-toggle-password');
    const regPasswordInput = document.getElementById('reg-password');
    const regToggleIcon = document.getElementById('reg-toggle-icon');

    if (regTogglePasswordBtn && regPasswordInput && regToggleIcon) {
        regTogglePasswordBtn.addEventListener('click', () => {
            if (regPasswordInput.type === 'password') {
                regPasswordInput.type = 'text';
                regToggleIcon.setAttribute('data-lucide', 'eye');
            } else {
                regPasswordInput.type = 'password';
                regToggleIcon.setAttribute('data-lucide', 'eye-off');
            }
            lucide.createIcons();
        });
    }

    // **** START: ADDED LOGIN PASSWORD TOGGLE (FIXED) ****
    // (ส่วนของ Login - ที่เพิ่มใหม่และแก้ไขแล้ว)
    const loginTogglePasswordBtn = document.getElementById('login-toggle-password');
    const loginPasswordInput = document.getElementById('login-password');
    const loginToggleIcon = document.getElementById('login-toggle-icon');

    if (loginTogglePasswordBtn && loginPasswordInput && loginToggleIcon) {
        loginTogglePasswordBtn.addEventListener('click', () => {
            if (loginPasswordInput.type === 'password') {
                loginPasswordInput.type = 'text';
                loginToggleIcon.setAttribute('data-lucide', 'eye');
            } else {
                loginPasswordInput.type = 'password';
                loginToggleIcon.setAttribute('data-lucide', 'eye-off');
            }
            lucide.createIcons();
        });
    }
    // **** END: ADDED LOGIN PASSWORD TOGGLE (FIXED) ****

    // --- Auth State Management ---
    const loggedOutView = document.getElementById('auth-logged-out');
    const loggedInView = document.getElementById('auth-logged-in');
    
    const userUsername = document.getElementById('user-username');
    const userPoints = document.getElementById('user-points');
    const adminNotifyBtn = document.getElementById('admin-notify-btn');
    const adminSettingsBtn = document.getElementById('admin-settings-btn');
    
    const pointPageUsername = document.getElementById('point-username');
    const readerCommentUsername = document.getElementById('reader-comment-username');
    const commentInputBox = document.getElementById('comment-input-box');

    onAuthStateChanged(auth, user => {
        if (user) {
            // User is LOGGED IN
            currentUser = user; 
            const userDocRef = doc(db, 'users', user.uid);
            
            getDoc(userDocRef)
                .then(docSnap => {
                    if (docSnap.exists()) {
                        currentUserData = docSnap.data(); 
                        
                        loggedOutView.style.display = 'none';
                        loggedInView.style.display = 'flex';
                        
                        userUsername.textContent = currentUserData.username;
                        userPoints.textContent = `${currentUserData.balancePoints} Points`;
                        
                        if (pointPageUsername) {
                            pointPageUsername.value = currentUserData.username;
                            pointPageUsername.placeholder = "";
                        }
                        
                        if (readerCommentUsername) readerCommentUsername.textContent = currentUserData.username;
                        if (commentInputBox) commentInputBox.style.display = 'block';
                        
                        if (currentUserData.role === 'admin') {
                            adminNotifyBtn.style.display = 'block';
                            adminSettingsBtn.style.display = 'block';
                            checkAdminNotifications(); 
                        } else {
                            adminNotifyBtn.style.display = 'none';
                            adminSettingsBtn.style.display = 'none';
                        }
                        
                        loadNovels();
                        
                    } else {
                        console.error("No user data found in Firestore!");
                        logout(); 
                    }
                })
                .catch(error => {
                    console.error("Error getting user data:", error);
                    logout(); 
                });

        } else {
            // User is LOGGED OUT
            currentUser = null;
            currentUserData = null;
            
            loggedOutView.style.display = 'flex';
            loggedInView.style.display = 'none';
            
            userUsername.textContent = '...';
            userPoints.textContent = '... Points';
            adminNotifyBtn.style.display = 'none';
            adminSettingsBtn.style.display = 'none';
            
            if (pointPageUsername) {
                pointPageUsername.value = '';
                pointPageUsername.placeholder = "กรุณาเข้าสู่ระบบ";
            }
            
            if (readerCommentUsername) readerCommentUsername.textContent = '...';
            if (commentInputBox) commentInputBox.style.display = 'none';
        }
    });
    
    // --- Auth Functions ---

    // 1. Register
    const registerForm = document.getElementById('register-form');
    registerForm.addEventListener('submit', (e) => {
        e.preventDefault(); 
        
        const username = document.getElementById('reg-username').value;
        const email = document.getElementById('reg-email').value;
        const password = document.getElementById('reg-password').value;
        
        createUserWithEmailAndPassword(auth, email, password)
            .then((userCredential) => {
                const user = userCredential.user;
                const userDocRef = doc(db, 'users', user.uid);
                
                return setDoc(userDocRef, {
                    username: username,
                    email: email,
                    balancePoints: 0,
                    role: 'user', 
                    createdAt: Timestamp.now(),
                    likedNovels: [] // **** ADDED: สำหรับปุ่ม Like ****
                });
            })
            .then(() => {
                Swal.fire({
                    icon: 'success',
                    title: 'ลงทะเบียนสำเร็จ!',
                    text: `ยินดีต้อนรับ ${username}!`,
                    timer: 2000,
                    showConfirmButton: false
                });
                showPage('page-home'); 
            })
            .catch((error) => {
                console.error("Register Error:", error);
                let errorMsg = "เกิดข้อผิดพลาด";
                if (error.code === 'auth/email-already-in-use') {
                    errorMsg = 'อีเมลนี้ถูกใช้งานแล้ว';
                } else if (error.code === 'auth/weak-password') {
                    errorMsg = 'รหัสผ่านสั้นเกินไป (ต้อง 6 ตัวอักษรขึ้นไป)';
                }
                Swal.fire('ลงทะเบียนไม่สำเร็จ', errorMsg, 'error');
            });
    });

    // 2. Login
    const loginForm = document.getElementById('login-form');
    loginForm.addEventListener('submit', (e) => {
        e.preventDefault();
        
        const email = document.getElementById('login-email').value;
        const password = document.getElementById('login-password').value;
        
        signInWithEmailAndPassword(auth, email, password)
            .then((userCredential) => {
                showPage('page-home'); 
                Swal.fire({
                    icon: 'success',
                    title: 'เข้าสู่ระบบสำเร็จ!',
                    toast: true,
                    position: 'top-end',
                    showConfirmButton: false,
                    timer: 2000
                });
            })
            .catch((error) => {
                console.error("Login Error:", error);
                Swal.fire('เข้าสู่ระบบไม่สำเร็จ', 'อีเมลหรือรหัสผ่านไม่ถูกต้อง', 'error');
            });
    });

    // 3. Logout
    window.logout = function() { 
        signOut(auth).then(() => {
            showPage('page-home');
        }).catch((error) => {
            console.error("Logout Error:", error);
        });
    }

    // --- Rich Text Editor Function ---
    window.formatDoc = function(cmd, editorId = 'novel-description-editor', value = null) {
        const editor = document.getElementById(editorId);
        
        if (editor) {
            document.execCommand(cmd, false, value); 
            editor.focus();
        } else {
            console.error("Editor element not found:", editorId);
        }
    }

    // --- Admin Functions ---
    
    // --- Admin: Novel (Add/Edit) ---
    
    window.setAdminNovelMode = function(mode) {
        const form = document.getElementById('add-novel-form');
        const title = document.getElementById('admin-novel-form-title');
        const saveBtnText = document.getElementById('admin-novel-save-btn-text');
        const tabBtn = document.getElementById('admin-tab-add-novel');
        
        if (mode === 'add') {
            currentEditingNovelId = null; 
            form.reset(); 
            document.getElementById('novel-description-editor').innerHTML = '';
            document.querySelectorAll('.novel-category-check').forEach(cb => cb.checked = false);
            
            title.textContent = "เพิ่มนิยายใหม่";
            saveBtnText.textContent = "Save New";
            tabBtn.classList.add('bg-purple-600', 'text-white');
            tabBtn.classList.remove('bg-gray-200', 'text-gray-700');
            
        } else if (mode === 'edit') {
            title.textContent = `กำลังแก้ไข: ${document.getElementById('novel-title-en').value}`;
            saveBtnText.textContent = "Update Novel";
            tabBtn.classList.remove('bg-purple-600', 'text-white');
            tabBtn.classList.add('bg-gray-200', 'text-gray-700');
        }
    }
    
    async function loadNovelsForDropdown(elementId) {
        const selectEl = document.getElementById(elementId);
        if (!db || !selectEl) return;
        
        if (novelCache.length > 0) {
            selectEl.innerHTML = `<option value="">เลือกนิยาย (${novelCache.length} เรื่อง)</option>`; 
            novelCache.forEach(novel => {
                const option = document.createElement('option');
                option.value = novel.id;
                option.textContent = `${novel.title_en} (${novel.language})`;
                selectEl.appendChild(option);
            });
            return;
        }
        
        selectEl.innerHTML = '<option value="">กำลังโหลดนิยาย...</option>';
        try {
            const querySnapshot = await getDocs(collection(db, "novels"));
            novelCache = []; 
            selectEl.innerHTML = `<option value="">เลือกนิยาย (${querySnapshot.size} เรื่อง)</option>`;
            
            querySnapshot.forEach((doc) => {
                const novel = doc.data();
                novel.id = doc.id;
                novelCache.push(novel); 
                
                const option = document.createElement('option');
                option.value = novel.id;
                option.textContent = `${novel.title_en} (${novel.language.toUpperCase()})`;
                selectEl.appendChild(option);
            });
        } catch (error) {
            console.error("Error loading novels for dropdown:", error);
            selectEl.innerHTML = '<option value="">!! โหลดไม่สำเร็จ !!</option>';
        }
    }

    async function loadNovelForEditing() {
        const novelId = document.getElementById('edit-novel-select').value;
        if (!novelId) {
            Swal.fire('ข้อผิดพลาด', 'กรุณาเลือกนิยายก่อน', 'warning');
            return;
        }
        
        try {
            const docRef = doc(db, "novels", novelId);
            const docSnap = await getDoc(docRef);

            if (docSnap.exists()) {
                const novel = docSnap.data();
                
                document.getElementById('novel-cover-url').value = novel.coverImageUrl || '';
                document.getElementById('novel-title-en').value = novel.title_en || '';
                document.getElementById('novel-title-th').value = novel.title_th || '';
                document.getElementById('novel-title-original').value = novel.title_original || '';
                document.getElementById('novel-author').value = novel.author || '';
                document.getElementById('novel-language').value = novel.language || '';
                document.getElementById('novel-status').value = novel.status || '';
                document.getElementById('novel-licensed').checked = novel.isLicensed || false;
                document.getElementById('novel-description-editor').innerHTML = novel.description || '';
                
                document.querySelectorAll('.novel-category-check').forEach(cb => cb.checked = false); 
                if (novel.categories && novel.categories.length > 0) {
                    novel.categories.forEach(catName => {
                        const checkboxToCheck = document.querySelector(`.novel-category-check[value="${catName}"]`);
                        if (checkboxToCheck) checkboxToCheck.checked = true;
                    });
                }
                
                currentEditingNovelId = novelId; 
                setAdminNovelMode('edit');
                
                Swal.fire('โหลดสำเร็จ', `กำลังแก้ไข "${novel.title_en}"`, 'success');
                
            } else {
                Swal.fire('ไม่พบข้อมูล', 'ไม่พบนิยายนี้ในฐานข้อมูล', 'error');
            }
        } catch (error) {
            Swal.fire('เกิดข้อผิดพลาด', error.message, 'error');
        }
    }
    document.getElementById('load-novel-to-edit-btn').addEventListener('click', loadNovelForEditing);

    document.getElementById('add-novel-form').addEventListener('submit', async (e) => { 
        e.preventDefault(); 
        
        const categoriesCheckboxes = document.querySelectorAll('.novel-category-check:checked');
        const categories = Array.from(categoriesCheckboxes).map(cb => cb.value);

        const novelData = {
            title_en: document.getElementById('novel-title-en').value,
            title_th: document.getElementById('novel-title-th').value,
            title_original: document.getElementById('novel-title-original').value,
            author: document.getElementById('novel-author').value,
            coverImageUrl: document.getElementById('novel-cover-url').value,
            description: document.getElementById('novel-description-editor').innerHTML,
            language: document.getElementById('novel-language').value,
            status: document.getElementById('novel-status').value,
            categories: categories,
            isLicensed: document.getElementById('novel-licensed').checked,
        };
        
        try {
            if (currentEditingNovelId) {
                // --- โหมด Update ---
                const novelDocRef = doc(db, 'novels', currentEditingNovelId);
                await updateDoc(novelDocRef, novelData);
                
                Swal.fire('อัปเดตสำเร็จ!', `นิยายเรื่อง "${novelData.title_en}" ถูกอัปเดตแล้ว`, 'success');
                loadNovels(); 
                setAdminNovelMode('add'); 
                
            } else {
                // --- โหมด Add ---
                novelData.totalLikes = 0; 
                novelData.createdAt = Timestamp.now();
                novelData.lastChapterUpdatedAt = Timestamp.now();
                
                await addDoc(collection(db, 'novels'), novelData);
                
                Swal.fire('เพิ่มนิยายสำเร็จ!', `นิยายเรื่อง "${novelData.title_en}" ถูกบันทึกแล้ว`, 'success');
                loadNovels(); 
                setAdminNovelMode('add'); 
            }
        } catch (error) {
            Swal.fire('เกิดข้อผิดพลาด', error.message, 'error');
        }
    });
    
    // --- Admin: Chapter (Add/Edit) ---
    
    window.setAdminChapterMode = function(mode) {
        const form = document.getElementById('add-chapter-form');
        const title = document.getElementById('admin-chapter-form-title');
        const saveBtnText = document.getElementById('admin-chapter-save-btn-text');
        const tabBtn = document.getElementById('admin-tab-add-chapter');
        
        if (mode === 'add') {
            currentEditingChapterId = null; 
            form.reset(); 
            document.getElementById('chapter-content-editor').innerHTML = '';
            
            title.textContent = "เพิ่มตอนใหม่";
            saveBtnText.textContent = "Save New";
            tabBtn.classList.add('bg-purple-600', 'text-white');
            tabBtn.classList.remove('bg-gray-200', 'text-gray-700');
            
        } else if (mode === 'edit') {
            title.textContent = `กำลังแก้ไข: ${document.getElementById('chapter-title').value}`;
            saveBtnText.textContent = "Update Chapter";
            tabBtn.classList.remove('bg-purple-600', 'text-white');
            tabBtn.classList.add('bg-gray-200', 'text-gray-700');
        }
    }

    async function loadChaptersForEditDropdown(novelId) {
        const selectEl = document.getElementById('edit-chapter-select');
        const loadBtn = document.getElementById('load-chapter-to-edit-btn');
        if (!db || !selectEl || !loadBtn) return;

        if (!novelId) {
            selectEl.innerHTML = '<option value="">(กรุณาเลือกนิยายก่อน)</option>';
            selectEl.disabled = true;
            loadBtn.disabled = true;
            return;
        }

        selectEl.innerHTML = '<option value="">กำลังโหลดตอน...</option>';
        selectEl.disabled = false;
        loadBtn.disabled = false;
        
        try {
            const q = query(collection(db, "chapters"), where("novelId", "==", novelId));
            const querySnapshot = await getDocs(q);
            
            let chapters = [];
            querySnapshot.forEach((doc) => {
                chapters.push({ id: doc.id, ...doc.data() });
            });
            
            chapters.sort((a, b) => a.chapterNumber - b.chapterNumber); 
            
            selectEl.innerHTML = `<option value="">เลือกตอน... (${chapters.length} ตอน)</option>`;
            
            if (chapters.length === 0) {
                 selectEl.innerHTML = '<option value="">(ยังไม่มีตอน)</option>';
                 selectEl.disabled = true;
                 loadBtn.disabled = true;
                 return;
            }
            
            chapters.forEach(chapter => {
                const option = document.createElement('option');
                option.value = chapter.id;
                option.textContent = `ตอนที่ ${chapter.chapterNumber}: ${chapter.title}`;
                selectEl.appendChild(option);
            });

        } catch (error) {
            console.error("Error loading chapters for dropdown:", error);
            selectEl.innerHTML = '<option value="">!! โหลดไม่สำเร็จ !!</option>';
        }
    }
    document.getElementById('edit-chapter-novel-select').addEventListener('change', (e) => {
        loadChaptersForEditDropdown(e.target.value);
    });

    async function loadChapterForEditing() {
        const chapterId = document.getElementById('edit-chapter-select').value;
        if (!chapterId) {
            Swal.fire('ข้อผิดพลาด', 'กรุณาเลือกตอนก่อน', 'warning');
            return;
        }
        
        try {
            const docRef = doc(db, "chapters", chapterId);
            const docSnap = await getDoc(docRef);
            
            if (docSnap.exists()) {
                const chapter = docSnap.data();
                
                document.getElementById('chapter-novel-select').value = chapter.novelId || '';
                document.getElementById('chapter-number').value = chapter.chapterNumber || '';
                document.getElementById('chapter-title').value = chapter.title || '';
                document.getElementById('chapter-content-editor').innerHTML = chapter.content || '';
                
                let pointValue;
                if (chapter.pointCost === 0) pointValue = '0';
                else if (chapter.type === 'Normal') pointValue = `${chapter.pointCost}`;
                else pointValue = `${chapter.pointCost}-${chapter.type}`;
                document.getElementById('chapter-point-type').value = pointValue;
                
                if (chapter.scheduledAt) {
                    const date = chapter.scheduledAt.toDate();
                    date.setMinutes(date.getMinutes() - date.getTimezoneOffset());
                    document.getElementById('chapter-schedule').value = date.toISOString().slice(0,16);
                } else {
                    document.getElementById('chapter-schedule').value = '';
                }
                
                currentEditingChapterId = chapterId; 
                setAdminChapterMode('edit');
                
                Swal.fire('โหลดสำเร็จ', `กำลังแก้ไข "${chapter.title}"`, 'success');
                
            } else {
                Swal.fire('ไม่พบข้อมูล', 'ไม่พบนิยายนี้ในฐานข้อมูล', 'error');
            }
        } catch (error) {
            console.log(error);
            Swal.fire('เกิดข้อผิดพลาด', error.message, 'error');
        }
    }
    document.getElementById('load-chapter-to-edit-btn').addEventListener('click', loadChapterForEditing);

    document.getElementById('add-chapter-form').addEventListener('submit', async (e) => { 
        e.preventDefault();
        
        const pointTypeValue = document.getElementById('chapter-point-type').value;
        let pointCost = 0;
        let chapterType = 'Normal';
        
        if (pointTypeValue.includes('-')) {
            const parts = pointTypeValue.split('-');
            pointCost = parseInt(parts[0]);
            chapterType = parts[1];
        } else {
            pointCost = parseInt(pointTypeValue);
            if (pointCost === 20) chapterType = 'NC';
        }

        const scheduleTimeInput = document.getElementById('chapter-schedule').value;
        let scheduledAt = Timestamp.now();
        if (scheduleTimeInput) {
            scheduledAt = Timestamp.fromDate(new Date(scheduleTimeInput));
        }
        
        const chapterData = {
            novelId: document.getElementById('chapter-novel-select').value,
            chapterNumber: parseFloat(document.getElementById('chapter-number').value),
            title: document.getElementById('chapter-title').value,
            content: document.getElementById('chapter-content-editor').innerHTML,
            pointCost: pointCost,
            type: chapterType,
            scheduledAt: scheduledAt,
        };
        
        if (!chapterData.novelId || !chapterData.title || isNaN(chapterData.chapterNumber)) {
            Swal.fire('ข้อมูลไม่ครบ', 'กรุณากรอก "นิยาย", "ตอนที่", และ "ชื่อตอน" ให้ครบ', 'warning');
            return;
        }
        
        const parentNovelRef = doc(db, 'novels', chapterData.novelId);

        try {
            if (currentEditingChapterId) {
                // --- โหมด Update ---
                const chapterDocRef = doc(db, 'chapters', currentEditingChapterId);
                await updateDoc(chapterDocRef, chapterData);
                await updateDoc(parentNovelRef, {
                    lastChapterUpdatedAt: Timestamp.now()
                });
                
                Swal.fire('อัปเดตสำเร็จ!', `ตอน "${chapterData.title}" ถูกอัปเดตแล้ว`, 'success');
                setAdminChapterMode('add'); 
                
            } else {
                // --- โหมด Add ---
                chapterData.createdAt = Timestamp.now(); 
                await addDoc(collection(db, 'chapters'), chapterData);
                await updateDoc(parentNovelRef, {
                    lastChapterUpdatedAt: Timestamp.now()
                });
                
                Swal.fire('เพิ่มตอนใหม่สำเร็จ!', `ตอน "${chapterData.title}" ถูกบันทึกแล้ว`, 'success');
                setAdminChapterMode('add'); 
            }
            
            loadNovels(); 
            
        } catch (error) {
             Swal.fire('เกิดข้อผิดพลาด', error.message, 'error');
        }
    });
    
    // --- Load Novels (Main Feed) ---
    async function loadNovels() {
        if (!db) return; 
        
        const containers = {
            'KR': document.getElementById('novel-container-kr'),
            'CN': document.getElementById('novel-container-cn'),
            'EN': document.getElementById('novel-container-en'),
            'JP': document.getElementById('novel-container-jp')
        };
        
        ['KR', 'CN', 'EN', 'JP'].forEach(lang => {
            containers[lang].innerHTML = ''; 
            const loadingText = document.getElementById(`novel-loading-${lang.toLowerCase()}`);
            if (loadingText) loadingText.style.display = 'block'; 
        });
        
        const homeUpdatesContainer = document.getElementById('home-latest-updates');
        homeUpdatesContainer.innerHTML = ''; // ล้างหน้า Home
        
        try {
            const querySnapshot = await getDocs(collection(db, "novels"));
            
            novelCache = []; 
            let novelCount = { KR: 0, CN: 0, EN: 0, JP: 0 };
            const threeDaysAgo = Date.now() - (3 * 24 * 60 * 60 * 1000);
            
            let allNovels = [];
            querySnapshot.forEach((doc) => {
                allNovels.push({ id: doc.id, ...doc.data() });
            });
            
            allNovels.sort((a, b) => {
                const timeA = a.lastChapterUpdatedAt ? a.lastChapterUpdatedAt.toDate().getTime() : 0;
                const timeB = b.lastChapterUpdatedAt ? b.lastChapterUpdatedAt.toDate().getTime() : 0;
                return timeB - timeA;
            });
            
            allNovels.forEach(novel => {
                const novelId = novel.id;
                novelCache.push(novel); 
                
                const lang = novel.language.toUpperCase(); 
                
                if (containers[lang]) {
                    novelCount[lang]++;
                    
                    const card = document.createElement('div');
                    card.className = "bg-white rounded-lg shadow-md overflow-hidden transform transition-transform hover:scale-105 cursor-pointer";
                    card.setAttribute('onclick', `showNovelDetail('${novelId}', '${novel.status}')`); 
                    
                    let licensedBadge = '';
                    if (novel.isLicensed) {
                        licensedBadge = '<span class="absolute top-2 left-2 bg-red-600 text-white text-xs font-bold px-2 py-1 rounded">ลิขสิทธิ์</span>';
                    }
                    
                    let newBadge = '';
                    let isNew = false;
                    if (novel.lastChapterUpdatedAt && novel.lastChapterUpdatedAt.toDate().getTime() > threeDaysAgo) {
                        newBadge = '<span class="absolute top-2 right-2 bg-purple-600 text-white text-xs font-bold px-2 py-1 rounded animate-pulse">NEW</span>';
                        isNew = true;
                    }
                    
                    card.innerHTML = `
                        <div class="relative">
                            <img src="${novel.coverImageUrl}" alt="${novel.title_en}" class="w-full h-auto aspect-[2/3] object-cover">
                            ${licensedBadge}
                            ${newBadge}
                        </div>
                        <div class="p-3">
                            <h4 class="font-bold text-md truncate">${novel.title_en}</h4>
                        </div>
                    `;
                    containers[lang].appendChild(card);
                    
                    if (isNew && homeUpdatesContainer.childElementCount < 5) {
                         const homeCard = document.createElement('div');
                         homeCard.className = "flex items-center space-x-3 p-2 hover:bg-gray-50 rounded-lg cursor-pointer";
                         homeCard.onclick = () => showNovelDetail(novelId, novel.status);
                         homeCard.innerHTML = `
                            <img src="${novel.coverImageUrl}" alt="${novel.title_en}" class="w-12 h-16 object-cover rounded">
                            <div>
                                <h5 class="font-semibold text-purple-700">${novel.title_en}</h5>
                                <p class="text-sm text-gray-500">${novel.author}</p>
                            </div>
                         `;
                         homeUpdatesContainer.appendChild(homeCard);
                    }
                }
            });
            
            ['KR', 'CN', 'EN', 'JP'].forEach(lang => {
                const loadingText = document.getElementById(`novel-loading-${lang.toLowerCase()}`);
                if (loadingText) loadingText.style.display = 'none'; 
                
                if (novelCount[lang] === 0) {
                    containers[lang].innerHTML = '<p class="text-gray-500 col-span-full">ยังไม่มีนิยายในหมวดนี้...</p>';
                }
            });
            
            if (homeUpdatesContainer.childElementCount === 0) {
                homeUpdatesContainer.innerHTML = '<p class="text-gray-500">ยังไม่มีนิยายที่อัปเดต...</p>';
            }

        } catch (error) {
            console.error("Error loading novels: ", error);
            ['KR', 'CN', 'EN', 'JP'].forEach(lang => {
                containers[lang].innerHTML = '<p class="text-red-500 col-span-full">ไม่สามารถโหลดนิยายได้</p>';
                const loadingText = document.getElementById(`novel-loading-${lang.toLowerCase()}`);
                if (loadingText) loadingText.style.display = 'none';
            });
        }
    }

    // --- Load Novel Details ---
    
    function getChapterBadge(pointCost, type) {
        if (pointCost === 0) return `<span class="text-sm font-medium px-2 py-1 rounded" style="color: #778899; border: 1px solid #778899;">อ่านฟรี</span>`;
        if (pointCost === 5) return `<span class="text-sm font-medium px-2 py-1 rounded" style="background-color: #00bfff; color: white;">${pointCost} Points</span>`;
        if (pointCost === 10) return `<span class="text-sm font-medium px-2 py-1 rounded" style="background-color: #1e90ff; color: white;">${pointCost} Points</span>`;
        if (type === 'Side') return `<span class="text-sm font-medium px-2 py-1 rounded" style="background-color: #228b22; color: white;">${pointCost} Points</span>`;
        if (type === 'Special') return `<span class="text-sm font-medium px-2 py-1 rounded" style="background-color: #ff69b4; color: white;">${pointCost} Points</span>`;
        if (type === 'Extra') return `<span class="text-sm font-medium px-2 py-1 rounded" style="background-color: #ff7f50; color: white;">${pointCost} Points</span>`;
        if (type === 'NC') return `<span class="text-sm font-medium px-2 py-1 rounded" style="background-color: #ff3b3b; color: white;">${pointCost} Points</span>`;
        return `<span class="text-sm font-medium px-2 py-1 rounded" style="background-color: #1e90ff; color: white;">${pointCost} Points</span>`;
    }

    async function loadNovelDetails(novelId) {
        if (!db || !novelId) return;
        
        document.getElementById('detail-cover-img').src = 'https://placehold.co/400x600/C4B5FD/FFFFFF?text=Loading...';
        document.getElementById('detail-title-en').textContent = 'กำลังโหลดชื่อเรื่อง...';
        document.getElementById('detail-title-th').textContent = '...';
        document.getElementById('detail-author').textContent = '...';
        document.getElementById('detail-language').textContent = '...';
        document.getElementById('detail-status').textContent = '...';
        document.getElementById('detail-chapters-count').textContent = '...'; 
        document.getElementById('detail-description').innerHTML = '<p>กำลังโหลดเรื่องย่อ...</p>';
        document.getElementById('detail-categories').innerHTML = '<span class="bg-gray-200 text-gray-500 text-sm px-3 py-1 rounded-full animate-pulse">...</span>';
        
        const likeBtn = document.getElementById('detail-like-btn');
        likeBtn.innerHTML = `<i data-lucide="heart"></i> <span>Like (...)</span>`;
        likeBtn.disabled = true; 
        likeBtn.className = "mt-4 w-full bg-pink-100 text-pink-600 py-2 rounded-lg flex items-center justify-center space-x-2 transition-colors";

        try {
            const docRef = doc(db, "novels", novelId);
            const docSnap = await getDoc(docRef);

            if (docSnap.exists()) {
                const novel = docSnap.data();
                
                document.getElementById('detail-cover-img').src = novel.coverImageUrl;
                document.getElementById('detail-title-en').textContent = novel.title_en;
                document.getElementById('detail-title-th').textContent = novel.title_th || ''; 
                document.getElementById('detail-author').textContent = novel.author;
                document.getElementById('detail-language').textContent = novel.language.toUpperCase();
                document.getElementById('detail-status').textContent = novel.status;
                document.getElementById('detail-description').innerHTML = novel.description;
                
                const categoriesContainer = document.getElementById('detail-categories');
                categoriesContainer.innerHTML = ''; 
                if (novel.categories && novel.categories.length > 0) {
                    novel.categories.forEach(cat => {
                        const span = document.createElement('span');
                        span.className = "bg-purple-100 text-purple-700 text-sm px-3 py-1 rounded-full";
                        span.textContent = cat;
                        categoriesContainer.appendChild(span);
                    });
                } else {
                    categoriesContainer.innerHTML = '<span class="text-gray-400 text-sm">ไม่มีประเภท</span>';
                }
                
                // **** START: UPDATED LIKE BUTTON ****
                // โหลดสถานะ Like (ต้องทำหลัง Login Check)
                checkUserLikeStatus(novelId, novel.totalLikes);
                // **** END: UPDATED LIKE BUTTON ****
                
                lucide.createIcons();
                
            } else {
                console.error("No such novel document!");
                document.getElementById('detail-title-en').textContent = 'ไม่พบนิยายนี้';
            }
        } catch (error) {
            console.error("Error getting novel details: ", error);
            document.getElementById('detail-title-en').textContent = 'เกิดข้อผิดพลาด';
        }
    }

    async function loadNovelChapters(novelId) {
        if (!db || !novelId) return;
        
        const chapterListContainer = document.getElementById('detail-chapter-list-container');
        const chaptersCountEl = document.getElementById('detail-chapters-count');
        
        chapterListContainer.innerHTML = '<div class="p-3 text-gray-500">กำลังโหลดสารบัญ...</div>';
        chaptersCountEl.textContent = '...';
        
        try {
            const q = query(collection(db, "chapters"), where("novelId", "==", novelId));
            const querySnapshot = await getDocs(q);
            
            let chapters = [];
            querySnapshot.forEach((doc) => {
                chapters.push({ id: doc.id, ...doc.data() });
            });
            
            chapters.sort((a, b) => a.chapterNumber - b.chapterNumber);
            
            chaptersCountEl.textContent = `${chapters.length} ตอน`;
            
            chapterListContainer.innerHTML = ''; 
            
            if (chapters.length === 0) {
                chapterListContainer.innerHTML = '<div class="p-3 text-gray-500">ยังไม่มีตอน...</div>';
                return;
            }
            
            chapters.forEach(chapter => {
                const chapterId = chapter.id;
                
                const chapterEl = document.createElement('div');
                chapterEl.className = "flex justify-between items-center p-3 hover:bg-gray-50 cursor-pointer";
                chapterEl.onclick = () => window.showReaderPage(chapterId, chapter.pointCost);
                
                const titleSpan = `<span class="text-gray-800">ตอนที่ ${chapter.chapterNumber}: ${chapter.title}</span>`;
                const badgeSpan = getChapterBadge(chapter.pointCost, chapter.type);
                
                chapterEl.innerHTML = titleSpan + badgeSpan;
                chapterListContainer.appendChild(chapterEl);
            });
            
        } catch (error) {
            console.error("Error loading chapters: ", error);
            chapterListContainer.innerHTML = '<div class="p-3 text-red-500">ไม่สามารถโหลดสารบัญได้</div>';
        }
    }

    async function loadAndShowNovelDetail(novelId) {
        showPage('page-novel-detail');
        await Promise.all([
            loadNovelDetails(novelId),
            loadNovelChapters(novelId)
        ]);
    }
    
    // --- Reader Functions ---
    
    async function loadChapterContent(chapterId) {
        console.log(`Loading content for chapter ${chapterId}`);
        
        const readerTitle = document.getElementById('reader-title');
        const readerChapterTitle = document.getElementById('reader-chapter-title');
        const readerContentDiv = document.getElementById('reader-content-div');
        
        const currentNovel = novelCache.find(n => n.id === currentOpenNovelId);
        readerTitle.textContent = currentNovel ? currentNovel.title_en : 'กำลังโหลด...';
        readerChapterTitle.textContent = '...';
        readerContentDiv.innerHTML = '<p>กำลังโหลดเนื้อหา...</p>';
        
        showPage('page-reader');
        
        try {
            const chapterDocRef = doc(db, 'chapters', chapterId);
            const docSnap = await getDoc(chapterDocRef);
            
            if (docSnap.exists()) {
                const chapter = docSnap.data();
                
                readerChapterTitle.textContent = `ตอนที่ ${chapter.chapterNumber}: ${chapter.title}`;
                readerContentDiv.innerHTML = chapter.content;
                currentOpenChapterTitle = chapter.title; 
                
                loadComments(chapterId); 
                
            } else {
                readerChapterTitle.textContent = 'ไม่พบเนื้อหา';
                readerContentDiv.innerHTML = '<p>ขออภัย, ไม่พบเนื้อหาของตอนนี้</p>';
            }
        } catch (error) {
            console.error("Error loading chapter content:", error);
            readerChapterTitle.textContent = 'เกิดข้อผิดพลาด';
            readerContentDiv.innerHTML = '<p>ไม่สามารถโหลดเนื้อหาได้</p>';
        }
    }

    window.showPointAlert = function(chapterId, pointCost) {
        if (currentUserData.balancePoints < pointCost) {
            Swal.fire({
                icon: 'error',
                title: 'Points ไม่เพียงพอ!',
                text: `คุณมี ${currentUserData.balancePoints} Points, แต่ตอนนี้ต้องใช้ ${pointCost} Points`,
                confirmButtonColor: '#8B5CF6',
                confirmButtonText: 'ไปหน้าเติมคะแนน'
            }).then(() => {
                showPage('page-add-point');
            });
            return; 
        }
        
        Swal.fire({
            title: `ยืนยันการอ่าน`,
            text: `ตอนนี้ต้องใช้ ${pointCost} Points. คุณมี ${currentUserData.balancePoints} Points`,
            icon: 'warning',
            showCancelButton: true,
            confirmButtonColor: '#8B5CF6',
            cancelButtonColor: '#6B7280',
            confirmButtonText: `อ่านต่อ (หัก ${pointCost} Points)`,
            cancelButtonText: 'ยกเลิก'
        }).then(async (result) => {
            if (result.isConfirmed) {
                try {
                    const newPoints = currentUserData.balancePoints - pointCost;
                    const userDocRef = doc(db, 'users', currentUser.uid);
                    
                    await updateDoc(userDocRef, {
                        balancePoints: newPoints
                    });
                    
                    currentUserData.balancePoints = newPoints;
                    userPoints.textContent = `${newPoints} Points`;
                    
                    Swal.fire(
                        'หัก Point สำเร็จ!',
                        `ระบบหัก ${pointCost} Points. คุณมี ${newPoints} Points`,
                        'success'
                    );
                    
                    loadChapterContent(chapterId);
                    
                } catch (error) {
                    console.error("Error updating points: ", error);
                    Swal.fire('เกิดข้อผิดพลาด', 'ไม่สามารถหัก Point ได้', 'error');
                }
            }
        });
    }

    window.showReaderPage = function(chapterId, pointCost) {
        console.log(`Attempting to read chapter ${chapterId} with cost ${pointCost}`);
        
        currentOpenChapterId = chapterId;
        
        if (!currentUser || !currentUserData) {
            Swal.fire({
                icon: 'info',
                title: 'กรุณาเข้าสู่ระบบ',
                text: 'คุณต้องเข้าสู่ระบบก่อนจึงจะอ่านได้',
                confirmButtonColor: '#8B5CF6',
                confirmButtonText: 'ไปหน้า Login'
            }).then(() => {
                showPage('page-login');
            });
            return;
        }
        
        // TODO: เพิ่ม Logic ตรวจสอบว่าเคยซื้อตอนนี้หรือยัง (Collection 'userPurchases')
        
        if (pointCost === 0) {
            loadChapterContent(chapterId);
        } else {
            window.showPointAlert(chapterId, pointCost); 
        }
    }
    
    // --- Comment Functions ---
    
    async function checkAdminNotifications() {
        if (!db || !currentUserData || currentUserData.role !== 'admin') {
            return;
        }
        
        const badge = document.getElementById('admin-notify-badge');
        
        try {
            const q = query(collection(db, "comments"), where("isReadByAdmin", "==", false));
            const querySnapshot = await getDocs(q);
            const unreadCount = querySnapshot.size;
            
            if (unreadCount > 0) {
                badge.textContent = unreadCount > 9 ? '9+' : unreadCount;
                badge.classList.remove('hidden');
            } else {
                badge.classList.add('hidden');
            }
        } catch (error) {
            console.error("Error checking admin notifications:", error);
        }
    }
    
    async function loadAdminNotifications() {
        const container = document.getElementById('admin-notify-container');
        if (!db || !container) return;
        
        container.innerHTML = '<p class="text-gray-500 p-3">กำลังโหลดการแจ้งเตือน...</p>';
        
        try {
            const q = query(collection(db, "comments"), where("isReadByAdmin", "==", false));
            const querySnapshot = await getDocs(q);
            
            let unreadComments = [];
            querySnapshot.forEach((doc) => {
                unreadComments.push({ id: doc.id, ...doc.data() });
            });
            
            unreadComments.sort((a, b) => b.createdAt - a.createdAt);
            
            container.innerHTML = ''; 
            
            if (unreadComments.length === 0) {
                container.innerHTML = '<p class="text-gray-500 p-3">ไม่มีคอมเมนต์ที่ยังไม่อ่าน</p>';
                return;
            }
            
            unreadComments.forEach(comment => {
                const novel = novelCache.find(n => n.id === comment.novelId);
                const novelTitle = novel ? novel.title_en : 'นิยายที่ถูกลบไปแล้ว';
            
                const card = document.createElement('div');
                card.id = `comment-card-${comment.id}`; 
                card.className = "p-3 border rounded-lg bg-gray-50 space-y-2";
                card.innerHTML = `
                    <div class="flex justify-between items-center">
                        <span class="font-semibold text-purple-700">${comment.username}</span>
                        <span class="text-xs text-gray-500">${comment.createdAt.toDate().toLocaleString()}</span>
                    </div>
                    <p class="text-gray-600 text-sm">ใน: <strong>${novelTitle}</strong> / <i>${comment.chapterTitle || '...'}</i></p>
                    <p class="p-2 bg-white border rounded-md">${comment.message.replace(/\n/g, '<br>')}</p>
                    <button onclick="markCommentAsRead('${comment.id}')" class="text-sm text-white bg-green-500 hover:bg-green-600 px-3 py-1 rounded-md">
                        Mark as Read
                    </button>
                    <!-- TODO: Add "Go to comment" button -->
                `;
                container.appendChild(card);
            });
            
        } catch (error) {
            console.error("Error loading admin notifications:", error);
            container.innerHTML = '<p class="text-red-500 p-3">ไม่สามารถโหลดการแจ้งเตือนได้</p>';
        }
    }
    
    window.markCommentAsRead = async function(commentId) {
        if (!db) return;
        try {
            const commentDocRef = doc(db, 'comments', commentId);
            await updateDoc(commentDocRef, {
                isReadByAdmin: true
            });
            
            document.getElementById(`comment-card-${commentId}`).style.display = 'none';
            checkAdminNotifications();
            
        } catch (error) {
            console.error("Error marking comment as read:", error);
            Swal.fire('เกิดข้อผิดพลาด', error.message, 'error');
        }
    }

    async function loadComments(chapterId) {
        const container = document.getElementById('reader-comment-container');
        if (!db || !container) return;
        
        container.innerHTML = '<p class="text-gray-500 p-3">กำลังโหลดคอมเมนต์...</p>';
        
        try {
            const q = query(collection(db, "comments"), where("chapterId", "==", chapterId));
            const querySnapshot = await getDocs(q);
            
            let comments = [];
            querySnapshot.forEach((doc) => {
                comments.push({ id: doc.id, ...doc.data() });
            });
            
            comments.sort((a, b) => a.createdAt - b.createdAt);
            
            container.innerHTML = ''; 
            
            if (comments.length === 0) {
                container.innerHTML = '<p class="text-gray-500 p-3">ยังไม่มีคอมเมนต์...</p>';
                return;
            }
            
            comments.forEach(comment => {
                if (comment.parentCommentId) return; 
                
                const profileImg = "https://placehold.co/40x40/A5B4FC/FFFFFF?text=C";
                
                const commentEl = document.createElement('div');
                commentEl.className = 'flex space-x-3';
                commentEl.innerHTML = `
                    <img src="${profileImg}" class="rounded-full w-10 h-10">
                    <div class="flex-1">
                        <div class="bg-gray-100 p-3 rounded-lg">
                            <span class="font-semibold">${comment.username}</span>
                            <p>${comment.message.replace(/\n/g, '<br>')}</p>
                        </div>
                        <div class="flex space-x-3 text-sm text-gray-500 mt-1">
                            <span>Like (${comment.totalLikes})</span>
                            <span>Reply</span>
                        </div>
                        <!-- TODO: Reply Input/Output -->
                    </div>
                `;
                container.appendChild(commentEl);
            });
            
        } catch (error) {
            console.error("Error loading comments:", error);
            container.innerHTML = '<p class="text-red-500 p-3">ไม่สามารถโหลดคอมเมนต์ได้</p>';
        }
    }
    
    async function saveComment() {
        const message = document.getElementById('reader-comment-input').value;
        
        if (!currentUserData) {
            Swal.fire('ข้อผิดพลาด', 'กรุณาเข้าสู่ระบบก่อนคอมเมนต์', 'error');
            return;
        }
        if (!message.trim()) {
            Swal.fire('ข้อผิดพลาด', 'กรุณาพิมพ์ข้อความ', 'warning');
            return;
        }
        if (!currentOpenChapterId) {
            console.error("currentOpenChapterId is not set!");
            Swal.fire('ข้อผิดพลาด', 'ไม่พบ ID ของตอน', 'error');
            return;
        }
        
        const commentData = {
            chapterId: currentOpenChapterId,
            novelId: currentOpenNovelId,
            chapterTitle: currentOpenChapterTitle || '...',
            userId: currentUser.uid,
            username: currentUserData.username,
            profileIcon: "default", 
            message: message,
            parentCommentId: null, 
            totalLikes: 0,
            createdAt: Timestamp.now(),
            isReadByAdmin: false 
        };
        
        try {
            await addDoc(collection(db, "comments"), commentData);
            
            document.getElementById('reader-comment-input').value = ''; 
            loadComments(currentOpenChapterId); 
            checkAdminNotifications(); 
            
        } catch (error) {
            console.error("Error saving comment:", error);
            Swal.fire('เกิดข้อผิดพลาด', 'ไม่สามารถบันทึกคอมเมนต์ได้', 'error');
        }
    }
    document.getElementById('reader-comment-post-btn').addEventListener('click', saveComment);
    
    // --- Like Button Function ---
    // **** START: NEW LIKE FUNCTION (Updated) ****
    // (เปลี่ยนเป็น window. function)
    window.toggleNovelLike = async function() {
        // 1. ตรวจสอบ Login
        if (!currentUser) {
            Swal.fire({
                icon: 'info',
                title: 'กรุณาเข้าสู่ระบบ',
                text: 'คุณต้องเข้าสู่ระบบก่อนจึงจะกด Like ได้',
                confirmButtonColor: '#8B5CF6',
                confirmButtonText: 'ไปหน้า Login'
            }).then(() => showPage('page-login'));
            return;
        }
        
        // 2. ตรวจสอบว่ามี Novel ID
        if (!currentOpenNovelId) {
            console.error("No novel ID selected!");
            return;
        }
        
        const likeBtn = document.getElementById('detail-like-btn');
        likeBtn.disabled = true; // ปิดปุ่มชั่วคราว
        
        const novelDocRef = doc(db, 'novels', currentOpenNovelId);
        // **** START: UPDATED LIKE PATH (Sub-collection) ****
        // สร้าง "สมุดจด" ใน user ว่า Like เรื่องนี้
        const likeDocRef = doc(db, 'users', currentUser.uid, 'likedNovels', currentOpenNovelId);
        // **** END: UPDATED LIKE PATH (Sub-collection) ****
        
        try {
            const docSnap = await getDoc(likeDocRef);
            
            if (docSnap.exists()) {
                // --- 3. เคย Like แล้ว (กำลัง Unlike) ---
                await deleteDoc(likeDocRef); // ลบจาก "สมุดจด"
                await updateDoc(novelDocRef, {
                    totalLikes: increment(-1) // ลด -1
                });
                // โหลดสถานะปุ่มใหม่ (เพื่อเอาเลขที่อัปเดต)
                const novelSnap = await getDoc(novelDocRef);
                checkUserLikeStatus(currentOpenNovelId, novelSnap.data().totalLikes);
                
            } else {
                // --- 4. ยังไม่เคย Like (กำลัง Like) ---
                await setDoc(likeDocRef, { likedAt: Timestamp.now() }); // เพิ่มใน "สมุดจด"
                await updateDoc(novelDocRef, {
                    totalLikes: increment(1) // เพิ่ม +1
                });
                // โหลดสถานะปุ่มใหม่
                const novelSnap = await getDoc(novelDocRef);
                checkUserLikeStatus(currentOpenNovelId, novelSnap.data().totalLikes);
            }
        } catch (error) {
            console.error("Error toggling like:", error);
            Swal.fire('เกิดข้อผิดพลาด', error.message, 'error');
            likeBtn.disabled = false; // เปิดปุ่มคืน
        }
    }
    // **** END: NEW LIKE FUNCTION (Updated) ****

    // --- Main Page Functions ---
    
    window.showNovelDetail = function(novelId, status) { 
        currentOpenNovelId = novelId;
        console.log(`Setting currentOpenNovelId: ${novelId}`);
        
        if (status === 'Other') {
            Swal.fire({
                title: 'นิยายเรื่องนี้ยังไม่ทราบตอนจบ',
                text: 'คุณต้องการอ่านต่อหรือไม่?',
                icon: 'info',
                showCancelButton: true,
                confirmButtonColor: '#8B5CF6',
                cancelButtonColor: '#6B7280',
                confirmButtonText: 'อ่านต่อ',
                cancelButtonText: 'กลับหน้าหลัก'
            }).then((result) => {
                if (result.isConfirmed) {
                    loadAndShowNovelDetail(novelId);
                }
            });
        } else {
            loadAndShowNovelDetail(novelId);
        }
    }

}; // --- จบ window.onload ---
