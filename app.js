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
    deleteDoc, 
    increment,
    arrayUnion,
    orderBy,
    limit,
    startAfter // [NEW] ใช้สำหรับการแบ่งหน้า
} from "https://www.gstatic.com/firebasejs/9.6.1/firebase-firestore.js";

// ============================================================
// ⚠️ นำค่า Config เดิมของคุณมาวางทับตรงนี้ ⚠️
// ============================================================
const firebaseConfig = {
    apiKey: "AIzaSyAEWniC7Ka-5a0lyBUuqhSswkNnYOd7wY4",
    authDomain: "linguaverse-novel.firebaseapp.com",
    projectId: "linguaverse-novel",
    messagingSenderId: "31579058890",
    appId: "1:31579058890:web:08c8f2ab8161eaf0587a33"
};
// ============================================================

// --- Global Variables ---
let app, auth, db;
let currentUser = null; 
let currentUserData = null;
let currentOpenNovelId = null;
let currentOpenChapterId = null;
let currentOpenChapterTitle = null;
let novelCache = [];
let currentEditingNovelId = null;
let currentEditingChapterId = null;
let currentNovelChapters = [];

// [NEW] ตัวแปรสำหรับ Pagination
let lastVisibleChapter = null; // จำตัวสุดท้ายที่โหลด
let isMoreChaptersAvailable = true; // มีตอนเหลืออีกไหม
const CHAPTERS_PER_PAGE = 50; // โหลดทีละ 50 ตอน

// ตารางคะแนน
const pointPackages = {
    "25": 255, "50": 515, "75": 770, "100": 1025, "150": 1530  
};

// ============================================================
//  1. HELPER FUNCTIONS
// ============================================================

async function loadNovelsForDropdown(elementId) {
    const selectEl = document.getElementById(elementId);
    const authorDatalist = document.getElementById('author-datalist'); 
    if (!db || !selectEl) return;
    
    const updateAuthorList = (novels) => {
        if (!authorDatalist) return;
        const authors = new Set();
        novels.forEach(n => { if (n.author) authors.add(n.author.trim()); });
        authorDatalist.innerHTML = '';
        authors.forEach(author => {
            const option = document.createElement('option');
            option.value = author;
            authorDatalist.appendChild(option);
        });
    };

    if (novelCache.length > 0) {
        selectEl.innerHTML = `<option value="">เลือกนิยาย (${novelCache.length} เรื่อง)</option>`;
        novelCache.forEach(novel => {
            const option = document.createElement('option');
            option.value = novel.id;
            option.textContent = `${novel.title_en} (${novel.language})`;
            selectEl.appendChild(option);
        });
        updateAuthorList(novelCache); 
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
        updateAuthorList(novelCache);
    } catch (error) {
        console.error("Error loading novels for dropdown:", error);
        selectEl.innerHTML = '<option value="">!! โหลดไม่สำเร็จ !!</option>';
    }
}

async function loadNovelForEditing() {
    const novelId = document.getElementById('edit-novel-select').value;
    if (!novelId) { Swal.fire('ข้อผิดพลาด', 'กรุณาเลือกนิยายก่อน', 'warning'); return; }
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
            if (novel.categories) {
                novel.categories.forEach(catName => {
                    const checkboxToCheck = document.querySelector(`.novel-category-check[value="${catName}"]`);
                    if (checkboxToCheck) checkboxToCheck.checked = true;
                });
            }
            currentEditingNovelId = novelId;
            window.setAdminNovelMode('edit');
            Swal.fire('โหลดสำเร็จ', `กำลังแก้ไข "${novel.title_en}"`, 'success');
        } else { Swal.fire('ไม่พบข้อมูล', 'ไม่พบนิยายนี้', 'error'); }
    } catch (error) { Swal.fire('เกิดข้อผิดพลาด', error.message, 'error'); }
}

async function loadChaptersForEditDropdown(novelId) {
    const selectEl = document.getElementById('edit-chapter-select');
    const loadBtn = document.getElementById('load-chapter-to-edit-btn');
    if (!db || !selectEl || !loadBtn) return;
    selectEl.innerHTML = '<option value="">(กรุณาเลือกนิยายก่อน)</option>';
    selectEl.disabled = true;
    loadBtn.disabled = true;
    if (!novelId) return;
    selectEl.innerHTML = '<option value="">กำลังโหลดตอน...</option>';
    try {
        // Dropdown แก้ไข โหลดมาทั้งหมด (Admin ไม่ต้อง Pagination เพราะตอนไม่เยอะเท่าคนอ่านเปิดพร้อมกัน)
        const q = query(collection(db, "chapters"), where("novelId", "==", novelId));
        const querySnapshot = await getDocs(q);
        let chapters = [];
        querySnapshot.forEach((doc) => { chapters.push({ id: doc.id, ...doc.data() }); });
        chapters.sort((a, b) => a.chapterNumber - b.chapterNumber); 
        selectEl.innerHTML = `<option value="">เลือกตอน... (${chapters.length} ตอน)</option>`;
        if (chapters.length === 0) {
             selectEl.innerHTML = '<option value="">(นิยายเรื่องนี้ยังไม่มีตอน)</option>';
             selectEl.disabled = true;
             loadBtn.disabled = true;
             return;
        }
        selectEl.disabled = false;
        loadBtn.disabled = false;
        chapters.forEach(chapter => {
            const option = document.createElement('option');
            option.value = chapter.id;
            option.textContent = `ตอนที่ ${chapter.chapterNumber}: ${chapter.title}`;
            selectEl.appendChild(option);
        });
    } catch (error) {
        console.error("Error loading chapters:", error);
        selectEl.innerHTML = '<option value="">!! โหลดไม่สำเร็จ !!</option>';
    }
}

async function loadChapterForEditing() {
    const chapterId = document.getElementById('edit-chapter-select').value;
    if (!chapterId) { Swal.fire('ข้อผิดพลาด', 'กรุณาเลือกตอนก่อน', 'warning'); return; }
    
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
            window.setAdminChapterMode('edit');
            Swal.fire('โหลดสำเร็จ', 'พร้อมแก้ไข', 'success');
        } else { Swal.fire('ไม่พบข้อมูล', 'ไม่พบนิยายนี้', 'error'); }
    } catch (error) { Swal.fire('เกิดข้อผิดพลาด', error.message, 'error'); }
}

async function loadAdminNotifications() {
    const container = document.getElementById('admin-notify-container');
    if (!db || !container) return;
    container.innerHTML = '<p class="text-gray-500 p-3">กำลังโหลด...</p>';
    try {
        const q = query(collection(db, "comments"), where("isReadByAdmin", "==", false));
        const querySnapshot = await getDocs(q);
        let unreadComments = [];
        querySnapshot.forEach((doc) => { unreadComments.push({ id: doc.id, ...doc.data() }); });
        unreadComments.sort((a, b) => b.createdAt - a.createdAt);
        container.innerHTML = ''; 
        if (unreadComments.length === 0) {
            container.innerHTML = '<p class="text-gray-500 p-3">ไม่มีคอมเมนต์ใหม่</p>';
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
                <p class="text-gray-600 text-sm">ใน: <strong>${novelTitle}</strong></p>
                <p class="p-2 bg-white border rounded-md">${comment.message}</p>
                <button onclick="window.markCommentAsRead('${comment.id}')" class="text-sm text-white bg-green-500 px-3 py-1 rounded-md">Mark Read</button>
            `;
            container.appendChild(card);
        });
    } catch (error) { container.innerHTML = '<p class="text-red-500">โหลดไม่สำเร็จ</p>'; }
}

window.loadAdminTopupRequests = async function() {
    const container = document.getElementById('admin-topup-list');
    if (!db || !container) return;
    container.innerHTML = '<tr><td colspan="4" class="px-4 py-4 text-center">กำลังโหลด...</td></tr>';
    try {
        const q = query(collection(db, "topup_requests"), where("status", "==", "pending"));
        const querySnapshot = await getDocs(q);
        let requests = [];
        querySnapshot.forEach((doc) => { requests.push({ id: doc.id, ...doc.data() }); });
        requests.sort((a, b) => a.createdAt - b.createdAt);
        
        container.innerHTML = '';
        if (requests.length === 0) {
            container.innerHTML = '<tr><td colspan="4" class="px-4 py-4 text-center text-gray-500">ไม่มีรายการรออนุมัติ</td></tr>';
            return;
        }
        requests.forEach(req => {
            const row = document.createElement('tr');
            row.innerHTML = `
               <td class="px-4 py-3 text-sm text-gray-900">${req.username}</td>
                <td class="px-4 py-3 text-sm font-bold text-purple-600">${req.amount} บ.</td>
                <td class="px-4 py-3 text-sm text-gray-500">${new Date(req.transferTime).toLocaleString('th-TH')}</td>
                <td class="px-4 py-3 text-sm space-x-2">
                    <button onclick="window.approveTopup('${req.id}', '${req.userId}', ${req.points}, '${req.username}')" class="bg-green-500 text-white px-2 py-1 rounded">อนุมัติ</button>
                    <button onclick="window.rejectTopup('${req.id}')" class="bg-red-500 text-white px-2 py-1 rounded">ยกเลิก</button>
                </td>
            `;
            container.appendChild(row);
        });
    } catch (error) { container.innerHTML = '<tr><td colspan="4" class="text-red-500 text-center">Error</td></tr>'; }
}

window.approveTopup = async function(reqId, userId, points, username) {
    Swal.fire({
        title: 'ยืนยันการอนุมัติ?',
        text: `เติม ${points} Points ให้ ${username}`,
        icon: 'question',
        showCancelButton: true,
        confirmButtonText: 'อนุมัติ'
    }).then(async (result) => {
        if (result.isConfirmed) {
            try {
                await updateDoc(doc(db, "topup_requests", reqId), { status: 'completed', approvedAt: Timestamp.now() });
                await updateDoc(doc(db, "users", userId), { balancePoints: increment(points) });
                Swal.fire('สำเร็จ!', 'เติม Points แล้ว', 'success');
                window.loadAdminTopupRequests();
                checkAdminNotifications();
             } catch (error) { Swal.fire('Error', 'เกิดข้อผิดพลาด', 'error'); }
        }
    });
}

window.rejectTopup = async function(reqId) {
    Swal.fire({ title: 'ยืนยันการยกเลิก?', icon: 'warning', showCancelButton: true, confirmButtonColor: '#d33', confirmButtonText: 'ยกเลิกรายการ' })
    .then(async (result) => {
        if (result.isConfirmed) {
            try {
                await updateDoc(doc(db, "topup_requests", reqId), { status: 'rejected', rejectedAt: Timestamp.now() });
                Swal.fire('เรียบร้อย', 'รายการถูกปฏิเสธ', 'info');
                window.loadAdminTopupRequests();
                checkAdminNotifications();
            } catch (error) { Swal.fire('Error', 'เกิดข้อผิดพลาด', 'error'); }
         }
    });
}

// ============================================================
//  CORE FUNCTION: Load Novels
// ============================================================
async function loadNovels() {
    if (!db) return;
    const containers = { 'KR': document.getElementById('novel-container-kr'), 'CN': document.getElementById('novel-container-cn'), 'EN': document.getElementById('novel-container-en'), 'JP': document.getElementById('novel-container-jp') };
    ['KR', 'CN', 'EN', 'JP'].forEach(lang => {
        if(containers[lang]) containers[lang].innerHTML = ''; 
        const loadingText = document.getElementById(`novel-loading-${lang.toLowerCase()}`);
        if (loadingText) loadingText.style.display = 'block'; 
    });
    const homeUpdatesContainer = document.getElementById('home-latest-updates');
    if(homeUpdatesContainer) homeUpdatesContainer.innerHTML = ''; 
    
    try {
        const querySnapshot = await getDocs(collection(db, "novels"));
        let allNovels = [];
        novelCache = []; 
        querySnapshot.forEach((doc) => { allNovels.push({ id: doc.id, ...doc.data() }); });
        novelCache = allNovels;
        allNovels.sort((a, b) => {
            const timeA = a.lastChapterUpdatedAt ? (a.lastChapterUpdatedAt.toDate ? a.lastChapterUpdatedAt.toDate().getTime() : 0) : 0;
            const timeB = b.lastChapterUpdatedAt ? (b.lastChapterUpdatedAt.toDate ? b.lastChapterUpdatedAt.toDate().getTime() : 0) : 0;
            return timeB - timeA;
        });
        const timeAgoLimit = Date.now() - (3 * 24 * 60 * 60 * 1000); 
        let novelCount = { KR: 0, CN: 0, EN: 0, JP: 0 };
        
        allNovels.forEach(novel => {
            const novelId = novel.id;
            const lang = novel.language ? novel.language.toUpperCase() : 'OTHER'; 
            if (containers[lang]) {
                novelCount[lang]++;
                const card = document.createElement('div');
                card.className = "novel-card group cursor-pointer relative";
                card.setAttribute('onclick', `window.showNovelDetail('${novelId}', '${novel.status}')`); 
                
                let licensedBadge = novel.isLicensed ? '<span class="absolute top-2 left-2 bg-red-600 text-white text-xs font-bold px-2 py-1 rounded shadow">ลิขสิทธิ์</span>' : '';
                let newBadge = '';
                if (novel.lastChapterUpdatedAt && (novel.lastChapterUpdatedAt.toDate ? novel.lastChapterUpdatedAt.toDate().getTime() : 0) > timeAgoLimit) {
                    newBadge = '<span class="absolute top-2 right-2 bg-purple-600 text-white text-xs font-bold px-2 py-1 rounded animate-pulse shadow">NEW</span>';
                }
                const rating = novel.rating || '5.0';
                const category = (novel.categories && novel.categories.length > 0) ? novel.categories[0] : 'นิยาย';
                card.innerHTML = `
                    <div class="relative overflow-hidden h-64">
                        <img src="${novel.coverImageUrl || 'https://placehold.co/300x450'}" alt="${novel.title_en}" class="w-full h-full object-cover transition-transform duration-500 group-hover:scale-110">
                        ${licensedBadge}${newBadge}
                    </div>
                    <div class="p-4">
                         <div class="flex justify-between items-start mb-2">
                              <span class="text-xs font-semibold text-purple-600 bg-purple-50 px-2 py-0.5 rounded-full border border-purple-100 truncate max-w-[70%]">${category}</span>
                            <span class="text-xs text-yellow-500 flex items-center"><i data-lucide="star" class="w-3 h-3 mr-1 fill-current"></i> ${rating}</span>
                        </div>
                       <h4 class="font-bold text-gray-800 text-md truncate mb-1" title="${novel.title_en}">${novel.title_en}</h4>
                        <p class="text-sm text-gray-500 truncate mb-3">${novel.author}</p>
                         <div class="flex justify-between items-center text-xs text-gray-400 border-t pt-3">
                             <span class="${novel.status === 'Ongoing' ? 'text-green-500' : 'text-blue-500'} font-medium">${novel.status}</span>
                        </div>
                    </div>
                `;
                containers[lang].appendChild(card);
                
                if (homeUpdatesContainer && homeUpdatesContainer.childElementCount < 4) {
                     const homeCard = document.createElement('div');
                     homeCard.className = "flex items-center space-x-4 p-3 hover:bg-purple-50 rounded-lg transition-colors cursor-pointer border-b border-gray-100 last:border-0";
                     homeCard.onclick = () => window.showNovelDetail(novelId, novel.status);
                     let updateTimeStr = "ล่าสุด";
                     if(novel.lastChapterUpdatedAt && novel.lastChapterUpdatedAt.toDate) {
                         updateTimeStr = novel.lastChapterUpdatedAt.toDate().toLocaleDateString('th-TH');
                    }
                     homeCard.innerHTML = `
                        <img src="${novel.coverImageUrl}" alt="${novel.title_en}" class="w-16 h-20 object-cover rounded shadow-sm flex-shrink-0">
                        <div class="flex-grow min-w-0">
                             <h4 class="font-bold text-gray-800 truncate text-base">${novel.title_en}</h4>
                            <p class="text-sm text-purple-600 mb-1"><i data-lucide="clock" class="w-3 h-3 inline"></i> ${updateTimeStr}</p>
                            <div class="flex items-center space-x-2 text-xs text-gray-500">
                                 <span class="bg-gray-100 px-2 py-0.5 rounded">${lang}</span>
                                 <span class="truncate max-w-[100px]">${novel.author}</span>
                            </div>
                        </div>
                        <div class="flex-shrink-0">
                            <button class="text-purple-600 hover:text-purple-800 bg-white border border-purple-200 hover:border-purple-600 px-3 py-1 rounded-full text-xs transition-all">อ่าน</button>
                        </div>
                     `;
                     homeUpdatesContainer.appendChild(homeCard);
                }
            }
        });
        
        ['KR', 'CN', 'EN', 'JP'].forEach(lang => {
            const loadingText = document.getElementById(`novel-loading-${lang.toLowerCase()}`);
            if (loadingText) loadingText.style.display = 'none'; 
            if (novelCount[lang] === 0 && containers[lang]) {
                containers[lang].innerHTML = '<p class="text-gray-500 col-span-full py-8 text-center">ยังไม่มีนิยายในหมวดนี้...</p>';
            }
        });
        if (homeUpdatesContainer && homeUpdatesContainer.childElementCount === 0) {
            homeUpdatesContainer.innerHTML = '<p class="text-gray-500">ยังไม่มีนิยายที่อัปเดต...</p>';
        }
        if (window.lucide) window.lucide.createIcons();
    } catch (error) {
        console.error("Error loading novels: ", error);
        ['KR', 'CN', 'EN', 'JP'].forEach(lang => {
            if(containers[lang]) containers[lang].innerHTML = '<p class="text-red-500 col-span-full">ไม่สามารถโหลดนิยายได้</p>';
            const loadingText = document.getElementById(`novel-loading-${lang.toLowerCase()}`);
            if (loadingText) loadingText.style.display = 'none';
        });
    }
}

window.filterNovels = function() {
    const searchText = document.getElementById('search-input').value.toLowerCase();
    const statusFilter = document.getElementById('filter-status').value;
    const categoryFilter = document.getElementById('filter-category').value;
    const containers = { 'KR': document.getElementById('novel-container-kr'), 'CN': document.getElementById('novel-container-cn'), 'EN': document.getElementById('novel-container-en'), 'JP': document.getElementById('novel-container-jp') };
    for(let key in containers) { if(containers[key]) containers[key].innerHTML = ''; }

    const timeAgoLimit = Date.now() - (3 * 24 * 60 * 60 * 1000);
    let hasResults = { 'KR': false, 'CN': false, 'EN': false, 'JP': false };
    novelCache.forEach(novel => {
        const matchText = novel.title_en.toLowerCase().includes(searchText) || (novel.title_th && novel.title_th.includes(searchText));
        const matchStatus = statusFilter === "" || novel.status === statusFilter;
        const matchCategory = categoryFilter === "" || (novel.categories && novel.categories.includes(categoryFilter));

         if (matchText && matchStatus && matchCategory) {
            const lang = novel.language ? novel.language.toUpperCase() : 'OTHER';
            if (containers[lang]) {
                hasResults[lang] = true;
                const card = document.createElement('div');
                card.className = "novel-card group cursor-pointer relative";
                card.setAttribute('onclick', `window.showNovelDetail('${novel.id}', '${novel.status}')`);
                let licensedBadge = novel.isLicensed ? '<span class="absolute top-2 left-2 bg-red-600 text-white text-xs font-bold px-2 py-1 rounded shadow">ลิขสิทธิ์</span>' : '';
                let newBadge = '';
                if (novel.lastChapterUpdatedAt && (novel.lastChapterUpdatedAt.toDate ? novel.lastChapterUpdatedAt.toDate().getTime() : 0) > timeAgoLimit) {
                    newBadge = '<span class="absolute top-2 right-2 bg-purple-600 text-white text-xs font-bold px-2 py-1 rounded animate-pulse shadow">NEW</span>';
                }
                const rating = novel.rating || '5.0';
                const category = (novel.categories && novel.categories.length > 0) ? novel.categories[0] : 'นิยาย';
                card.innerHTML = `
                    <div class="relative overflow-hidden h-64">
                        <img src="${novel.coverImageUrl || 'https://placehold.co/300x450'}" alt="${novel.title_en}" class="w-full h-full object-cover transition-transform duration-500 group-hover:scale-110">
                        ${licensedBadge}${newBadge}
                    </div>
                    <div class="p-4">
                         <div class="flex justify-between items-start mb-2">
                             <span class="text-xs font-semibold text-purple-600 bg-purple-50 px-2 py-0.5 rounded-full border border-purple-100 truncate max-w-[70%]">${category}</span>
                            <span class="text-xs text-yellow-500 flex items-center"><i data-lucide="star" class="w-3 h-3 mr-1 fill-current"></i> ${rating}</span>
                        </div>
                        <h4 class="font-bold text-gray-800 text-md truncate mb-1">${novel.title_en}</h4>
                         <div class="flex justify-between items-center text-xs text-gray-400 border-t pt-3">
                            <span class="${novel.status === 'Ongoing' ? 'text-green-500' : 'text-blue-500'} font-medium">${novel.status}</span>
                        </div>
                    </div>
                `;
                containers[lang].appendChild(card);
            }
        }
     });
    for(let key in containers) {
        if(!hasResults[key] && containers[key]) { containers[key].innerHTML = '<p class="text-gray-400 col-span-full text-center py-4">ไม่พบนิยายที่ค้นหา...</p>'; }
    }
    if (window.lucide) window.lucide.createIcons();
}

// ============================================================
//  2. STANDARD FUNCTIONS
// ============================================================

async function checkAdminNotifications() {
    if (!db || !currentUserData || currentUserData.role !== 'admin') { return; }
    const commentBadge = document.getElementById('admin-notify-badge');
    const topupBadge = document.getElementById('admin-topup-badge');
    const inboxBadge = document.getElementById('admin-inbox-badge');
    const inboxBtn = document.getElementById('admin-inbox-btn');
    if(inboxBtn) inboxBtn.style.display = 'block';
    try {
        const qComment = query(collection(db, "comments"), where("isReadByAdmin", "==", false));
        const snapComment = await getDocs(qComment);
        if (commentBadge) {
            const count = snapComment.size;
            if (count > 0) {
                commentBadge.textContent = count > 9 ? '9+' : count;
                commentBadge.classList.remove('hidden');
                commentBadge.style.display = ''; 
            } else {
                commentBadge.classList.add('hidden');
                commentBadge.style.display = 'none'; 
                commentBadge.textContent = '';
            }
        }
        const qTopup = query(collection(db, "topup_requests"), where("status", "==", "pending"));
        const snapTopup = await getDocs(qTopup);
        if (topupBadge) {
            const count = snapTopup.size;
            if (count > 0) {
                topupBadge.textContent = count > 9 ? '9+' : count;
                topupBadge.classList.remove('hidden');
                topupBadge.style.display = ''; 
            } else {
                topupBadge.classList.add('hidden');
                topupBadge.style.display = 'none';
            }
        }
        const qInbox = query(collection(db, "contact_messages"), where("isReadByAdmin", "==", false));
        const snapInbox = await getDocs(qInbox);
        if (inboxBadge) {
            const count = snapInbox.size;
            if (count > 0) {
                inboxBadge.textContent = count > 9 ? '9+' : count;
                inboxBadge.classList.remove('hidden');
                inboxBadge.style.display = ''; 
            } else {
                inboxBadge.classList.add('hidden');
                inboxBadge.style.display = 'none';
            }
        }
    } catch (error) { console.error("Error checking admin notifications:", error); }
}

async function loadAuthorOtherWorks(authorName, currentId) {
    const container = document.getElementById('detail-other-works');
    if(!container) return;
    container.innerHTML = '<div class="p-2 text-gray-400 text-sm animate-pulse">กำลังค้นหาผลงานอื่น...</div>';
    try {
        const q = query(collection(db, "novels"), where("author", "==", authorName));
        const querySnapshot = await getDocs(q);
        const otherWorks = [];
        querySnapshot.forEach((doc) => { if (doc.id !== currentId) { otherWorks.push({ id: doc.id, ...doc.data() }); } });
        container.innerHTML = '';
        if (otherWorks.length === 0) {
            container.innerHTML = '<div class="p-2 text-gray-400 text-sm">ไม่มีผลงานอื่นๆ ของผู้แต่งท่านนี้</div>';
            return;
        }
        otherWorks.forEach(work => {
            const item = document.createElement('div');
            item.className = "flex-shrink-0 w-28 flex flex-col items-center space-y-2 group";
            const imgWrapper = document.createElement('div');
            imgWrapper.className = "relative overflow-hidden rounded-md shadow-md w-full h-40 cursor-zoom-in";
            const img = document.createElement('img');
            img.src = work.coverImageUrl || 'https://placehold.co/100x150';
            img.className = "w-full h-full object-cover transition-transform duration-300 group-hover:scale-110";
            imgWrapper.onclick = (e) => { e.stopPropagation(); window.openImageModal(work.coverImageUrl); };
            imgWrapper.appendChild(img);
            const title = document.createElement('span');
            title.className = "text-xs text-center font-medium text-gray-600 line-clamp-2 group-hover:text-purple-600 cursor-pointer transition-colors";
            title.textContent = work.title_en;
            title.onclick = () => { window.showNovelDetail(work.id, work.status); window.scrollToTop(); };
            item.appendChild(imgWrapper);
            item.appendChild(title);
            container.appendChild(item);
        });
    } catch (error) { container.innerHTML = '<div class="p-2 text-red-400 text-sm">ไม่สามารถโหลดข้อมูลได้</div>'; }
}

async function checkUserLikeStatus(novelId, totalLikes) {
    const likeBtn = document.getElementById('detail-like-btn');
    const likeIcon = likeBtn.querySelector('i') || likeBtn.querySelector('svg');
    const likeText = likeBtn.querySelector('span');
    if(likeText) likeText.textContent = `Like (${totalLikes})`;
    if (!currentUser) {
        likeBtn.disabled = false;
        likeBtn.className = "mt-4 w-full bg-pink-100 text-pink-600 py-2 rounded-lg flex items-center justify-center space-x-2 transition-colors hover:bg-pink-200 cursor-pointer";
        if(likeIcon) likeIcon.setAttribute('fill', 'none');
        return;
    }
    try {
        const likeDocRef = doc(db, 'users', currentUser.uid, 'likedNovels', novelId);
        const docSnap = await getDoc(likeDocRef);
        likeBtn.disabled = false;
        if (docSnap.exists()) {
            likeBtn.className = "mt-4 w-full bg-pink-600 text-white py-2 rounded-lg flex items-center justify-center space-x-2 shadow-md transition-transform transform active:scale-95";
            if(likeIcon) likeIcon.setAttribute('fill', 'currentColor');
            likeBtn.setAttribute('data-liked', 'true');
        } else {
            likeBtn.className = "mt-4 w-full bg-pink-100 text-pink-600 py-2 rounded-lg flex items-center justify-center space-x-2 hover:bg-pink-200 transition-colors";
            if(likeIcon) likeIcon.setAttribute('fill', 'none');
            likeBtn.setAttribute('data-liked', 'false');
        }
        if (window.lucide) window.lucide.createIcons();
    } catch (error) { likeBtn.disabled = false; }
}

async function loadNovelDetails(novelId) {
    if (!db || !novelId) return;
    document.getElementById('detail-cover-img').src = 'https://placehold.co/400x600/C4B5FD/FFFFFF?text=Loading...';
    document.getElementById('detail-title-en').textContent = 'กำลังโหลด...';
    document.getElementById('detail-title-th').textContent = '...';
    document.getElementById('detail-author').textContent = '...';
    document.getElementById('detail-language').textContent = '...';
    document.getElementById('detail-status').textContent = '...';
    document.getElementById('detail-chapters-count').textContent = '...'; 
    
    const descEl = document.getElementById('detail-description');
    const toggleBtn = document.getElementById('toggle-desc-btn');
    descEl.innerHTML = '<p>กำลังโหลด...</p>';
    descEl.className = "text-gray-600 novel-content mb-2 transition-all duration-300";
    if(toggleBtn) { toggleBtn.classList.add('hidden'); toggleBtn.textContent = 'อ่านต่อ...'; }

    document.getElementById('detail-categories').innerHTML = '<span class="bg-gray-200 text-gray-500 text-sm px-3 py-1 rounded-full animate-pulse">...</span>';
    const likeBtn = document.getElementById('detail-like-btn');
    likeBtn.innerHTML = `<i data-lucide="heart"></i> <span>Like (...)</span>`;
    likeBtn.disabled = true;
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
            
            descEl.innerHTML = novel.description || "ไม่มีเรื่องย่อ";
            setTimeout(() => {
                if (descEl.scrollHeight > 180) {
                    descEl.classList.add('desc-truncated');
                    if(toggleBtn) { toggleBtn.classList.remove('hidden'); toggleBtn.textContent = 'อ่านต่อ... ▼'; }
                } else { descEl.classList.remove('desc-truncated'); }
            }, 50);

            const categoriesContainer = document.getElementById('detail-categories');
            categoriesContainer.innerHTML = '';
            if (novel.categories) {
                novel.categories.forEach(cat => {
                    const span = document.createElement('span');
                    span.className = "bg-purple-100 text-purple-700 text-sm px-3 py-1 rounded-full";
                    span.textContent = cat;
                    categoriesContainer.appendChild(span);
                });
            } else { categoriesContainer.innerHTML = '<span class="text-gray-400 text-sm">ไม่มีประเภท</span>'; }
            loadAuthorOtherWorks(novel.author, novelId);
            checkUserLikeStatus(novelId, novel.totalLikes || 0);
            if (window.lucide) lucide.createIcons();
        } else { document.getElementById('detail-title-en').textContent = 'ไม่พบนิยายนี้'; }
    } catch (error) { document.getElementById('detail-title-en').textContent = 'เกิดข้อผิดพลาด'; }
}

function getChapterBadge(pointCost, type, isUnlocked) {
    if (isUnlocked) { return `<span class="text-sm font-bold px-2 py-1 rounded" style="background-color: #4ade80; color: #065f46; box-shadow: 0 1px 2px rgba(0,0,0,0.1);">ซื้อแล้ว (อ่านเลย)</span>`; }
    if (pointCost === 0) return `<span class="text-sm font-medium px-2 py-1 rounded" style="color: #778899; border: 1px solid #778899;">อ่านฟรี</span>`;
    if (pointCost === 5) return `<span class="text-sm font-medium px-2 py-1 rounded" style="background-color: #00bfff; color: white;">${pointCost} Points</span>`;
    if (pointCost === 10) return `<span class="text-sm font-medium px-2 py-1 rounded" style="background-color: #1e90ff; color: white;">${pointCost} Points</span>`;
    if (type === 'Side') return `<span class="text-sm font-medium px-2 py-1 rounded" style="background-color: #228b22; color: white;">${pointCost} Points</span>`;
    if (type === 'Special') return `<span class="text-sm font-medium px-2 py-1 rounded" style="background-color: #ff69b4; color: white;">${pointCost} Points</span>`;
    if (type === 'Extra') return `<span class="text-sm font-medium px-2 py-1 rounded" style="background-color: #ff7f50; color: white;">${pointCost} Points</span>`;
    if (type === 'NC') return `<span class="text-sm font-medium px-2 py-1 rounded" style="background-color: #ff3b3b; color: white;">${pointCost} Points</span>`;
    return `<span class="text-sm font-medium px-2 py-1 rounded" style="background-color: #1e90ff; color: white;">${pointCost} Points</span>`;
}

// [UPDATED] ฟังก์ชันโหลดสารบัญแบบ Pagination (โหลดทีละ 50 ตอน)
async function loadNovelChapters(novelId, isReset = true) {
    if (!db || !novelId) return;
    const chapterListContainer = document.getElementById('detail-chapter-list-container');
    const chaptersCountEl = document.getElementById('detail-chapters-count');
    
    // ถ้าเป็นการโหลดใหม่ (Reset) ให้เคลียร์ค่าต่างๆ
    if (isReset) {
        lastVisibleChapter = null;
        isMoreChaptersAvailable = true;
        chapterListContainer.innerHTML = '<div class="p-3 text-gray-500">กำลังโหลดสารบัญ...</div>';
        chaptersCountEl.textContent = '...';
    }

    try {
        // สร้าง Query แบบ Pagination (เรียงตาม chapterNumber)
        let q;
        if (isReset) {
            q = query(
                collection(db, "chapters"), 
                where("novelId", "==", novelId),
                orderBy("chapterNumber", "asc"),
                limit(CHAPTERS_PER_PAGE)
            );
        } else {
            // โหลดหน้าถัดไป (เริ่มต่อจากตัวสุดท้ายที่จำไว้)
            q = query(
                collection(db, "chapters"), 
                where("novelId", "==", novelId),
                orderBy("chapterNumber", "asc"),
                startAfter(lastVisibleChapter),
                limit(CHAPTERS_PER_PAGE)
            );
        }

        const querySnapshot = await getDocs(q);
        
        // ถ้าโหลดครั้งแรก ให้เคลียร์ข้อความ "กำลังโหลด" ออกก่อน
        if (isReset) {
            chapterListContainer.innerHTML = '';
        }

        if (querySnapshot.empty) {
            isMoreChaptersAvailable = false;
            if (isReset) {
                chapterListContainer.innerHTML = '<div class="p-3 text-gray-500">ยังไม่มีตอน...</div>';
                chaptersCountEl.textContent = '0 ตอน';
            }
            // ลบปุ่ม Load More ถ้ามี
            const oldLoadMoreBtn = document.getElementById('btn-load-more-chapters');
            if(oldLoadMoreBtn) oldLoadMoreBtn.remove();
            return;
        }

        // จำตัวสุดท้ายไว้ใช้โหลดหน้าถัดไป
        lastVisibleChapter = querySnapshot.docs[querySnapshot.docs.length - 1];
        
        // เช็คว่าหมดหรือยัง (ถ้าโหลดมาได้น้อยกว่า 50 แปลว่าหมดแล้ว)
        if (querySnapshot.docs.length < CHAPTERS_PER_PAGE) {
            isMoreChaptersAvailable = false;
        }

        // แปลงข้อมูล
        let chapters = [];
        querySnapshot.forEach((doc) => {
            chapters.push({ id: doc.id, ...doc.data() });
        });

        // อัปเดตจำนวนตอนรวม (แบบคร่าวๆ หรือโชว์ว่าโหลดมาแล้วเท่าไหร่)
        // หมายเหตุ: การนับ count ทั้งหมดใน Firestore แพง เราอาจจะโชว์แค่ที่โหลดมา
        if (isReset) {
             // ถ้าอยากรู้จำนวนทั้งหมดจริงๆ ต้องแยก query count ต่างหาก (แต่เปลือง Read)
             // เอาเป็นว่าใส่ "..." ไว้ก่อน หรือโชว์เท่าที่โหลด
             chaptersCountEl.textContent = `แสดง ${chapters.length}+ ตอน`;
        }

        let unlockedChapters = [];
        if (currentUserData && currentUserData.unlockedChapters) {
            unlockedChapters = currentUserData.unlockedChapters;
        }

        const now = new Date();
        const isAdmin = currentUserData && currentUserData.role === 'admin';

        // วนลูปแสดงผล
        chapters.forEach(chapter => {
            const scheduledDate = chapter.scheduledAt ? chapter.scheduledAt.toDate() : new Date(0); 
            // ถ้าเป็น user ธรรมดา และยังไม่ถึงเวลาเผยแพร่ -> ไม่แสดง (หรือแสดงแบบล็อก)
            if (!isAdmin && scheduledDate > now) {
                return; 
            }

            const chapterId = chapter.id;
            const isUnlocked = unlockedChapters.includes(chapterId);
            
            let scheduleBadge = '';
            if (isAdmin && scheduledDate > now) {
                scheduleBadge = ' <span class="text-xs text-red-500 font-bold border border-red-500 px-1 rounded">⏳ รอเผยแพร่</span>';
            }

            const chapterEl = document.createElement('div');
            chapterEl.className = "flex justify-between items-center p-3 hover:bg-gray-50 cursor-pointer border-b border-gray-100";
            chapterEl.onclick = () => window.showReaderPage(chapterId, chapter.pointCost);
            const titleSpan = `<span class="text-gray-800">ตอนที่ ${chapter.chapterNumber}: ${chapter.title}${scheduleBadge}</span>`;
            const badgeSpan = getChapterBadge(chapter.pointCost, chapter.type, isUnlocked);
            chapterEl.innerHTML = titleSpan + badgeSpan;
            chapterListContainer.appendChild(chapterEl);
        });

        // จัดการปุ่ม Load More
        const oldLoadMoreBtn = document.getElementById('btn-load-more-chapters');
        if(oldLoadMoreBtn) oldLoadMoreBtn.remove();

        if (isMoreChaptersAvailable) {
            const loadMoreDiv = document.createElement('div');
            loadMoreDiv.id = 'btn-load-more-chapters';
            loadMoreDiv.className = "p-3 text-center";
            loadMoreDiv.innerHTML = `<button onclick="window.loadMoreChapters()" class="text-purple-600 hover:text-purple-800 font-medium text-sm">▼ โหลดตอนใหม่ๆ เพิ่มเติม (Load More)</button>`;
            chapterListContainer.appendChild(loadMoreDiv);
        }

    } catch (error) {
        console.error("Error loading chapters: ", error);
        if (isReset) chapterListContainer.innerHTML = '<div class="p-3 text-red-500">เกิดข้อผิดพลาดในการโหลดสารบัญ (ตรวจสอบ Index)</div>';
    }
}

// [NEW] ฟังก์ชันสำหรับปุ่ม Load More
window.loadMoreChapters = function() {
    if (currentOpenNovelId) {
        loadNovelChapters(currentOpenNovelId, false); // false = ไม่ reset (โหลดต่อ)
    }
}

async function loadAndShowNovelDetail(novelId) {
    window.showPage('page-novel-detail');
    await loadNovelDetails(novelId);
    await loadNovelChapters(novelId, true); // true = reset เริ่มโหลดใหม่
}

async function loadNovelChapterList(novelId) {
    if (!db || !novelId) return;
    if (currentNovelChapters.length > 0 && currentNovelChapters[0].novelId === novelId) return;
    try {
        const q = query(collection(db, "chapters"), where("novelId", "==", novelId));
        const querySnapshot = await getDocs(q);
        currentNovelChapters = [];
        querySnapshot.forEach((doc) => { currentNovelChapters.push({ id: doc.id, novelId: novelId, ...doc.data() }); });
        currentNovelChapters.sort((a, b) => a.chapterNumber - b.chapterNumber); 
    } catch (error) { currentNovelChapters = []; }
}

function createReaderNavigation(currentChapterId) {
    const navButtons = document.getElementById('reader-navigation-buttons');
    if (!navButtons) return;
    const currentIndex = currentNovelChapters.findIndex(c => c.id === currentChapterId);
    let prevButton = `<button disabled class="px-4 py-2 bg-gray-200 text-gray-500 rounded-lg flex items-center"><i data-lucide="arrow-left" class="w-4 h-4 mr-1"></i> ตอนก่อนหน้า</button>`;
    let nextButton = `<button disabled class="px-4 py-2 bg-gray-200 text-gray-500 rounded-lg flex items-center">ตอนถัดไป <i data-lucide="arrow-right" class="w-4 h-4 ml-1"></i></button>`;
    const now = new Date();
    const isAdmin = currentUserData && currentUserData.role === 'admin';
    if (currentIndex > 0) {
        const prevChapter = currentNovelChapters[currentIndex - 1];
        const prevDate = prevChapter.scheduledAt ? prevChapter.scheduledAt.toDate() : new Date(0);
        if (isAdmin || prevDate <= now) {
            prevButton = `<button onclick="window.showReaderPage('${prevChapter.id}', ${prevChapter.pointCost})" class="px-4 py-2 bg-purple-600 text-white rounded-lg shadow-md hover:bg-purple-700 flex items-center"><i data-lucide="arrow-left" class="w-4 h-4 mr-1"></i> ตอนก่อนหน้า</button>`;
        }
    }
    if (currentIndex < currentNovelChapters.length - 1) {
        const nextChapter = currentNovelChapters[currentIndex + 1];
        const nextDate = nextChapter.scheduledAt ? nextChapter.scheduledAt.toDate() : new Date(0);
        if (isAdmin || nextDate <= now) {
            nextButton = `<button onclick="window.showReaderPage('${nextChapter.id}', ${nextChapter.pointCost})" class="px-4 py-2 bg-purple-600 text-white rounded-lg shadow-md hover:bg-purple-700 flex items-center">ตอนถัดไป <i data-lucide="arrow-right" class="w-4 h-4 ml-1"></i></button>`;
        } else {
            nextButton = `<button disabled class="px-4 py-2 bg-gray-300 text-gray-500 rounded-lg flex items-center cursor-not-allowed">รอเผยแพร่... <i data-lucide="lock" class="w-4 h-4 ml-1"></i></button>`;
        }
    }
    navButtons.innerHTML = `${prevButton} ${nextButton}`;
    if (window.lucide) window.lucide.createIcons();
}

async function loadChapterContent(chapterId) {
    const readerTitle = document.getElementById('reader-title');
    const readerChapterTitle = document.getElementById('reader-chapter-title');
    const readerContentDiv = document.getElementById('reader-content-div');
    const navButtons = document.getElementById('reader-navigation-buttons'); 
    
    if (navButtons) navButtons.innerHTML = '';
    
    const currentNovel = novelCache.find(n => n.id === currentOpenNovelId);
    readerTitle.textContent = currentNovel ? currentNovel.title_en : 'กำลังโหลด...';
    readerChapterTitle.textContent = '...';
    readerContentDiv.innerHTML = '<div class="text-center p-10"><div class="animate-spin rounded-full h-10 w-10 border-b-2 border-purple-600 mx-auto"></div><p class="mt-4 text-gray-500">กำลังดาวน์โหลดเนื้อหา...</p></div>';
    
    window.showPage('page-reader');
    await loadNovelChapterList(currentOpenNovelId);
    
    try {
        const chapterDocRef = doc(db, 'chapters', chapterId);
        const docSnap = await getDoc(chapterDocRef);
        
        if (docSnap.exists()) {
            const chapter = docSnap.data();
            const now = new Date();
            const scheduledDate = chapter.scheduledAt ? chapter.scheduledAt.toDate() : new Date(0);
            const isAdmin = currentUserData && currentUserData.role === 'admin';
            
            if (!isAdmin && scheduledDate > now) {
                readerChapterTitle.textContent = 'ยังไม่เปิดให้อ่าน';
                readerContentDiv.innerHTML = `<div class="text-center p-10"><h3 class="text-xl font-bold text-red-500 mb-2">⚠️ ตอนนี้ยังไม่เผยแพร่</h3><p class="text-gray-600">เผยแพร่เมื่อ: ${scheduledDate.toLocaleString()}</p></div>`;
                createReaderNavigation(chapterId);
                return;
            }

            readerChapterTitle.textContent = `ตอนที่ ${chapter.chapterNumber}: ${chapter.title}`;
            currentOpenChapterTitle = chapter.title;

            readerContentDiv.innerHTML = chapter.content || '<p class="text-gray-400 text-center">-- ไม่พบเนื้อหา --</p>';
            
            createReaderNavigation(chapterId);
            loadComments(chapterId);
        } else {
            readerChapterTitle.textContent = 'ไม่พบเนื้อหา';
            readerContentDiv.innerHTML = '<p>ขออภัย, ไม่พบเอกสารของตอนนี้</p>';
        }
    } catch (error) {
        readerChapterTitle.textContent = 'เกิดข้อผิดพลาด';
        readerContentDiv.innerHTML = '<p>ไม่สามารถโหลดเนื้อหาได้</p>';
    }
}

async function loadComments(chapterId) {
    const container = document.getElementById('reader-comment-container');
    if (!db || !container) return;
    
    container.innerHTML = '<p class="text-gray-500 p-3">กำลังโหลดคอมเมนต์...</p>';
    try {
        const q = query(collection(db, "comments"), where("chapterId", "==", chapterId));
        const querySnapshot = await getDocs(q);
        let allComments = [];
        querySnapshot.forEach((doc) => { allComments.push({ id: doc.id, ...doc.data() }); });
        allComments.sort((a, b) => a.createdAt - b.createdAt);

        let myLikedCommentIds = new Set();
        if (currentUser) {
            const likesSnap = await getDocs(collection(db, `users/${currentUser.uid}/likedComments`));
            likesSnap.forEach(doc => myLikedCommentIds.add(doc.id));
        }

        const parentComments = allComments.filter(c => !c.parentCommentId);
        const childComments = allComments.filter(c => c.parentCommentId);

        container.innerHTML = ''; 
        if (parentComments.length === 0) {
            container.innerHTML = '<p class="text-gray-500 p-3">ยังไม่มีคอมเมนต์...</p>';
            return;
        }

        const createCommentHTML = (comment, isReply = false) => {
            const profileImg = comment.profileIcon === 'default' 
                ? "https://placehold.co/40x40/A5B4FC/FFFFFF?text=" + (comment.username ? comment.username[0].toUpperCase() : 'U')
                : comment.profileIcon;
            const isLiked = myLikedCommentIds.has(comment.id);
            const likeColorClass = isLiked ? "text-pink-600" : "text-gray-400 hover:text-pink-500";
            const fillVal = isLiked ? "currentColor" : "none";
            
            let replyBtnHTML = '';
            if (!isReply) {
                replyBtnHTML = `<span class="cursor-pointer hover:text-purple-600 ml-4" onclick="window.toggleReplyBox('${comment.id}')">Reply</span>`;
            }

            const marginLeft = isReply ? 'ml-12 border-l-2 border-purple-100 pl-3 mt-2' : 'mt-4';
            const cardBg = isReply ? 'bg-gray-50' : 'bg-white border border-gray-200';
            return `
            <div class="flex flex-col ${marginLeft}" id="comment-block-${comment.id}">
                <div class="flex space-x-3">
                    <img src="${profileImg}" class="rounded-full w-10 h-10 object-cover border border-gray-200">
                    <div class="flex-1">
                          <div class="${cardBg} p-3 rounded-lg shadow-sm relative group">
                            <div class="flex justify-between items-start">
                                <span class="font-semibold text-purple-700 text-sm">${comment.username}</span>
                                <span class="text-xs text-gray-400">${comment.createdAt ? comment.createdAt.toDate().toLocaleString() : ''}</span>
                            </div>
                            <p class="text-gray-700 mt-1 text-sm">${comment.message.replace(/\n/g, '<br>')}</p>
                        </div>
                        <div class="flex items-center text-xs mt-1.5 ml-1 select-none">
                            <button onclick="window.toggleCommentLike('${comment.id}')" class="flex items-center space-x-1 ${likeColorClass} transition-colors duration-200 group">
                                <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="${fillVal}" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="transform group-active:scale-125 transition-transform">
                                    <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"></path>
                                </svg>
                                <span class="font-medium">Like (${comment.totalLikes || 0})</span>
                            </button>
                            ${replyBtnHTML}
                        </div>
                        <div id="reply-box-${comment.id}" class="hidden mt-2 flex space-x-2 animate-fade-in">
                            <input type="text" id="reply-input-${comment.id}" placeholder="ตอบกลับคุณ ${comment.username}..." class="flex-1 border rounded-full px-4 py-1 text-sm focus:outline-none focus:border-purple-500 bg-gray-50">
                            <button onclick="window.submitReply('${comment.id}')" class="bg-purple-600 text-white px-3 py-1 rounded-full text-xs hover:bg-purple-700 shadow-sm">ส่ง</button>
                        </div>
                    </div>
                </div>
            </div>
            `;
        };

        parentComments.forEach(parent => {
            container.innerHTML += createCommentHTML(parent, false);
            const replies = childComments.filter(c => c.parentCommentId === parent.id);
            replies.forEach(reply => { container.innerHTML += createCommentHTML(reply, true); });
        });
    } catch (error) { container.innerHTML = '<p class="text-red-500 p-3">ไม่สามารถโหลดคอมเมนต์ได้</p>'; }
}

window.toggleCommentLike = async function(commentId) {
    if (!currentUser) { Swal.fire('กรุณาเข้าสู่ระบบ', 'ต้อง Login ก่อนกด Like นะคะ', 'warning'); return; }
    const commentRef = doc(db, "comments", commentId);
    const userLikeRef = doc(db, `users/${currentUser.uid}/likedComments/${commentId}`);
    try {
        const likeSnap = await getDoc(userLikeRef);
        if (likeSnap.exists()) {
            await deleteDoc(userLikeRef);
            await updateDoc(commentRef, { totalLikes: increment(-1) });
        } else {
            await setDoc(userLikeRef, { likedAt: Timestamp.now() });
            await updateDoc(commentRef, { totalLikes: increment(1) });
        }
        loadComments(currentOpenChapterId);
    } catch (error) { console.error("Error toggling comment like:", error); }
}

window.toggleReplyBox = function(commentId) {
    const box = document.getElementById(`reply-box-${commentId}`);
    if (box) {
        if (box.classList.contains('hidden')) {
            box.classList.remove('hidden');
            setTimeout(() => document.getElementById(`reply-input-${commentId}`).focus(), 100);
        } else { box.classList.add('hidden'); }
    }
}

window.submitReply = async function(parentCommentId) {
    if (!currentUser) return;
    const inputEl = document.getElementById(`reply-input-${parentCommentId}`);
    const message = inputEl.value.trim();
    if (!message) return;
    try {
        const commentData = {
            chapterId: currentOpenChapterId,
            novelId: currentOpenNovelId,
            chapterTitle: currentOpenChapterTitle || '...',
            userId: currentUser.uid,
            username: currentUserData.username,
            profileIcon: "default",
            message: message,
            parentCommentId: parentCommentId,
            totalLikes: 0,
            createdAt: Timestamp.now(),
            isReadByAdmin: false
        };
        await addDoc(collection(db, "comments"), commentData);
        inputEl.value = '';
        document.getElementById(`reply-box-${parentCommentId}`).classList.add('hidden');
        loadComments(currentOpenChapterId);
        checkAdminNotifications();
    } catch (error) { Swal.fire('Error', 'ส่งข้อความตอบกลับไม่สำเร็จ', 'error'); }
}

// ============================================================
//  3. WINDOW FUNCTIONS
// ============================================================

window.showPage = function(pageId) {
    document.querySelectorAll('.page').forEach(page => { page.classList.remove('active'); });
    const activePage = document.getElementById(pageId);
    if (activePage) { activePage.classList.add('active'); }
    if (pageId === 'page-admin-add-novel') { loadNovelsForDropdown('edit-novel-select'); window.setAdminNovelMode('add'); }
    if (pageId === 'page-admin-add-chapter') { loadNovelsForDropdown('chapter-novel-select'); loadNovelsForDropdown('edit-chapter-novel-select'); window.setAdminChapterMode('add'); }
    if (pageId === 'page-admin-notifications') { loadAdminNotifications(); }
    if (pageId === 'page-admin-topup') { loadAdminTopupRequests(); }
    if (pageId === 'page-admin-inbox') { loadAdminInbox(); }
    if (window.scrollToTop) window.scrollToTop();
    if (window.lucide) window.lucide.createIcons();
}

window.formatDoc = function(cmd, editorId = 'novel-description-editor', value = null) {
    // ป้องกันการ Submit Form อัตโนมัติถ้ากดปุ่มใน Form
    if(event) event.preventDefault();
    
    const editor = document.getElementById(editorId);
    if (editor) {
        editor.focus(); // ต้อง Focus ก่อนคำสั่งถึงจะทำงาน
        document.execCommand(cmd, false, value);
        editor.focus(); // Focus กลับมาอีกทีเพื่อให้พิมพ์ต่อได้เลย
    } else {
        console.error("Editor element not found:", editorId);
    }
}

window.toggleDescription = function() {
    const descEl = document.getElementById('detail-description');
    const btn = document.getElementById('toggle-desc-btn');
    if (descEl.classList.contains('desc-truncated')) {
        descEl.classList.remove('desc-truncated');
        descEl.classList.add('desc-expanded');
        btn.textContent = 'ย่อลง (Show Less) ▲';
    } else {
        descEl.classList.remove('desc-expanded');
        descEl.classList.add('desc-truncated');
        btn.textContent = 'อ่านต่อ... (Read More) ▼';
        descEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
}

window.setAdminNovelMode = function(mode) {
    const form = document.getElementById('add-novel-form');
    const title = document.getElementById('admin-novel-form-title');
    const saveBtnText = document.getElementById('admin-novel-save-btn-text');
    const tabBtn = document.getElementById('admin-tab-add-novel');
    const deleteBtn = document.getElementById('admin-delete-novel-btn');

    if (mode === 'add') {
        currentEditingNovelId = null;
        form.reset();
        document.getElementById('novel-description-editor').innerHTML = '';
        document.querySelectorAll('.novel-category-check').forEach(cb => cb.checked = false);
        title.textContent = "เพิ่มนิยายใหม่";
        saveBtnText.textContent = "Save New";
        tabBtn.classList.add('bg-purple-600', 'text-white');
        tabBtn.classList.remove('bg-gray-200', 'text-gray-700');
        if(deleteBtn) deleteBtn.classList.add('hidden'); 
    } else if (mode === 'edit') {
        title.textContent = `กำลังแก้ไข: ${document.getElementById('novel-title-en').value}`;
        saveBtnText.textContent = "Update Novel";
        tabBtn.classList.remove('bg-purple-600', 'text-white');
        tabBtn.classList.add('bg-gray-200', 'text-gray-700');
        if(deleteBtn) deleteBtn.classList.remove('hidden');
    }
}

window.deleteCurrentNovel = async function() {
    if (!currentEditingNovelId) return;
    Swal.fire({
        title: 'ยืนยันการลบ?',
        text: "นิยายเรื่องนี้จะหายไปจากระบบทันที! (กู้คืนไม่ได้)",
        icon: 'warning',
        showCancelButton: true,
        confirmButtonColor: '#d33',
        cancelButtonColor: '#3085d6',
        confirmButtonText: 'ใช่, ลบเลย',
        cancelButtonText: 'ยกเลิก'
    }).then(async (result) => {
        if (result.isConfirmed) {
            try {
                await deleteDoc(doc(db, "novels", currentEditingNovelId));
                const q = query(collection(db, "chapters"), where("novelId", "==", currentEditingNovelId));
                const querySnapshot = await getDocs(q);
                querySnapshot.forEach(async (doc) => { await deleteDoc(doc.ref); });
                Swal.fire('ลบเรียบร้อย!', 'นิยายถูกลบออกจากระบบแล้ว', 'success');
                window.setAdminNovelMode('add');
                loadNovels(); 
            } catch (error) { Swal.fire('เกิดข้อผิดพลาด', 'ไม่สามารถลบนิยายได้', 'error'); }
        }
    });
}

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

window.openImageModal = function(src) {
    const modal = document.getElementById('image-modal');
    const modalImg = document.getElementById('image-modal-content');
    if(modal && modalImg) {
        modalImg.src = src;
        modal.classList.remove('hidden');
        modal.classList.add('flex');
        if (window.lucide) window.lucide.createIcons();
    }
}

window.closeImageModal = function() {
    const modal = document.getElementById('image-modal');
    if(modal) { modal.classList.add('hidden'); modal.classList.remove('flex'); }
}

window.showReaderPage = function(chapterId, pointCost) {
    currentOpenChapterId = chapterId;
    if (!currentUser || !currentUserData) {
        Swal.fire({ icon: 'info', title: 'กรุณาเข้าสู่ระบบ', confirmButtonColor: '#8B5CF6', confirmButtonText: 'ไปหน้า Login' })
        .then(() => { window.showPage('page-login'); });
        return;
    }
    if (currentUserData.role === 'admin') { loadChapterContent(chapterId); return; }
    if (currentUserData.unlockedChapters && currentUserData.unlockedChapters.includes(chapterId)) { loadChapterContent(chapterId); return; }
    if (pointCost === 0) { loadChapterContent(chapterId); } else { window.showPointAlert(chapterId, pointCost); }
}

window.showPointAlert = function(chapterId, pointCost) {
    if (currentUserData.balancePoints < pointCost) {
        Swal.fire({ icon: 'error', title: 'Points ไม่เพียงพอ!', text: `มี ${currentUserData.balancePoints} Points, ต้องใช้ ${pointCost}`, confirmButtonColor: '#8B5CF6', confirmButtonText: 'ไปหน้าเติมคะแนน' })
        .then(() => { window.showPage('page-add-point'); });
        return; 
    }
    Swal.fire({ title: `ยืนยันการอ่าน`, text: `หัก ${pointCost} Points (คงเหลือ ${currentUserData.balancePoints})`, icon: 'warning', showCancelButton: true, confirmButtonColor: '#8B5CF6', confirmButtonText: `อ่านต่อ`, cancelButtonText: 'ยกเลิก' })
    .then(async (result) => {
        if (result.isConfirmed) {
            try {
                const newPoints = currentUserData.balancePoints - pointCost;
                const userDocRef = doc(db, 'users', currentUser.uid);
                await updateDoc(userDocRef, { balancePoints: newPoints, unlockedChapters: arrayUnion(chapterId) });
                currentUserData.balancePoints = newPoints;
                if (!currentUserData.unlockedChapters) currentUserData.unlockedChapters = [];
                currentUserData.unlockedChapters.push(chapterId);
                document.getElementById('user-points').textContent = `${newPoints} Points`;
                Swal.fire('สำเร็จ!', `หัก ${pointCost} Points แล้ว`, 'success');
                loadChapterContent(chapterId);
            } catch (error) { Swal.fire('เกิดข้อผิดพลาด', 'ไม่สามารถหัก Point ได้', 'error'); }
        }
    });
}

window.toggleNovelLike = async function() {
    if (!currentUser) { Swal.fire({ icon: 'info', title: 'กรุณาเข้าสู่ระบบ' }).then(() => window.showPage('page-login')); return; }
    if (!currentOpenNovelId) return;
    const likeBtn = document.getElementById('detail-like-btn');
    likeBtn.disabled = true;
    const novelDocRef = doc(db, 'novels', currentOpenNovelId);
    const likeDocRef = doc(db, 'users', currentUser.uid, 'likedNovels', currentOpenNovelId);
    try {
        const isLiked = likeBtn.getAttribute('data-liked') === 'true';
        if (isLiked) { await deleteDoc(likeDocRef); await updateDoc(novelDocRef, { totalLikes: increment(-1) }); } 
        else { await setDoc(likeDocRef, { likedAt: Timestamp.now() }); await updateDoc(novelDocRef, { totalLikes: increment(1) }); }
        const novelSnap = await getDoc(novelDocRef);
        checkUserLikeStatus(currentOpenNovelId, novelSnap.data().totalLikes);
    } catch (error) { likeBtn.disabled = false; }
}

window.markCommentAsRead = async function(commentId) {
    if (!db) return;
    const card = document.getElementById(`comment-card-${commentId}`);
    if (card) { card.style.transition = "opacity 0.3s"; card.style.opacity = "0"; setTimeout(() => card.style.display = 'none', 300); }
    const badge = document.getElementById('admin-notify-badge');
    if (badge) {
        let currentCount = parseInt(badge.innerText) || 0;
        let newCount = Math.max(0, currentCount - 1);
        if (newCount <= 0) { badge.classList.add('hidden'); badge.style.display = 'none'; } else { badge.innerText = newCount > 9 ? '9+' : newCount; }
    }
    try {
        await updateDoc(doc(db, 'comments', commentId), { isReadByAdmin: true });
        const container = document.getElementById('admin-notify-container');
        if(container && container.children.length <= 1) container.innerHTML = '<p class="text-gray-500 p-3 text-center">ไม่มีคอมเมนต์ที่ยังไม่อ่าน</p>';
    } catch (error) { console.error(error); if(card) card.style.display = 'block'; }
}

window.showNovelDetail = function(novelId, status) { 
    currentOpenNovelId = novelId;
    if (status === 'Other') {
        Swal.fire({ title: 'นิยายเรื่องนี้ยังไม่ทราบตอนจบ', text: 'ต้องการอ่านต่อหรือไม่?', icon: 'info', showCancelButton: true, confirmButtonColor: '#8B5CF6', confirmButtonText: 'อ่านต่อ' })
        .then((result) => { if (result.isConfirmed) loadAndShowNovelDetail(novelId); });
    } else { loadAndShowNovelDetail(novelId); }
}

window.logout = function() { 
    signOut(auth).then(() => { currentUser = null; currentUserData = null; window.showPage('page-home'); });
}

// ============================================================
//  4. INITIALIZATION & EVENT LISTENERS
// ============================================================

window.onload = function() {
    try { if (window.lucide) window.lucide.createIcons(); } catch (error) { console.error("Lucide error:", error); }
    
    try {
        if (firebaseConfig.apiKey === "xxx") { Swal.fire('Config Error', 'กรุณาใส่ Firebase Config', 'error'); return; }
        app = initializeApp(firebaseConfig);
        auth = getAuth(app);
        db = getFirestore(app);
        console.log("Firebase initialized (Firestore Only Mode)!");
    } catch (error) { console.error("Firebase init failed:", error); return; }
    
    document.addEventListener('contextmenu', function(e) {
        if (e.target.closest('.novel-read-container') || e.target.tagName === 'IMG') { e.preventDefault(); return false; }
    });
    document.onkeydown = function(e) {
        if (e.ctrlKey || e.metaKey) {
            if (['c', 'x', 'u', 's'].includes(e.key.toLowerCase())) {
                 if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.isContentEditable) return true;
                 e.preventDefault(); return false;
            }
        }
    };

    function setupPasswordToggle(btnId, inputId, iconId) {
        const btn = document.getElementById(btnId);
        const input = document.getElementById(inputId);
        const icon = document.getElementById(iconId);
        if (btn && input && icon) {
            btn.addEventListener('click', (e) => {
                e.preventDefault();
                const type = input.getAttribute('type') === 'password' ? 'text' : 'password';
                input.setAttribute('type', type);
                icon.setAttribute('data-lucide', type === 'text' ? 'eye' : 'eye-off');
                if (window.lucide) window.lucide.createIcons();
            });
        }
    }
    setupPasswordToggle('reg-toggle-password', 'reg-password', 'reg-toggle-icon');
    setupPasswordToggle('login-toggle-password', 'login-password', 'login-toggle-icon');
    
    const loadNovelEditBtn = document.getElementById('load-novel-to-edit-btn');
    if(loadNovelEditBtn) loadNovelEditBtn.addEventListener('click', loadNovelForEditing);

    const deleteNovelBtn = document.getElementById('admin-delete-novel-btn');
    if(deleteNovelBtn) deleteNovelBtn.addEventListener('click', window.deleteCurrentNovel);

    const addNovelForm = document.getElementById('add-novel-form');
    if(addNovelForm) {
        addNovelForm.addEventListener('submit', async (e) => { 
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
                    await updateDoc(doc(db, 'novels', currentEditingNovelId), novelData);
                    Swal.fire('สำเร็จ!', 'อัปเดตนิยายแล้ว', 'success');
                } else {
                    novelData.totalLikes = 0;
                    novelData.createdAt = Timestamp.now();
                    novelData.lastChapterUpdatedAt = Timestamp.now();
                    await addDoc(collection(db, 'novels'), novelData);
                    Swal.fire('สำเร็จ!', 'เพิ่มนิยายแล้ว', 'success');
                }
                loadNovels(); window.setAdminNovelMode('add');
            } catch (error) { Swal.fire('Error', error.message, 'error'); }
        });
    }

    const editChapterNovelSelect = document.getElementById('edit-chapter-novel-select');
    if(editChapterNovelSelect) editChapterNovelSelect.addEventListener('change', (e) => loadChaptersForEditDropdown(e.target.value));
    
    const loadChapterEditBtn = document.getElementById('load-chapter-to-edit-btn');
    if(loadChapterEditBtn) loadChapterEditBtn.addEventListener('click', loadChapterForEditing);

    const checkDuplicateChapter = async (novelId, chapterNum) => {
        if(!novelId || isNaN(chapterNum)) return false;
        const q = query(collection(db, "chapters"), where("novelId", "==", novelId), where("chapterNumber", "==", chapterNum));
        const snap = await getDocs(q);
        if(snap.empty) return false;
        let isDup = false;
        snap.forEach(doc => { if (currentEditingChapterId && doc.id === currentEditingChapterId) {} else { isDup = true; } });
        return isDup;
    };

    const chapNumInput = document.getElementById('chapter-number');
    if(chapNumInput) {
        chapNumInput.addEventListener('change', async function() {
            if(await checkDuplicateChapter(document.getElementById('chapter-novel-select').value, parseFloat(this.value))) {
                Swal.fire('แจ้งเตือน', `ตอนที่ ${this.value} มีอยู่ในระบบแล้ว!`, 'warning');
            }
        });
    }

    // [SYSTEM REVERTED] กลับมาบันทึกข้อมูลแบบ Text ปกติ
    const addChapterForm = document.getElementById('add-chapter-form');
    if(addChapterForm) {
        addChapterForm.addEventListener('submit', async (e) => { 
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
            const scheduledAt = scheduleTimeInput ? Timestamp.fromDate(new Date(scheduleTimeInput)) : Timestamp.now();
            
            const chapterData = {
                novelId: document.getElementById('chapter-novel-select').value,
                chapterNumber: parseFloat(document.getElementById('chapter-number').value),
                title: document.getElementById('chapter-title').value,
                pointCost: pointCost,
                type: chapterType,
                scheduledAt: scheduledAt,
                content: document.getElementById('chapter-content-editor').innerHTML // [สำคัญ] บันทึกเนื้อหาตรงนี้
            };

            if (!chapterData.novelId || !chapterData.title || isNaN(chapterData.chapterNumber)) {
                Swal.fire('ข้อมูลไม่ครบ', 'กรุณากรอกให้ครบ', 'warning'); return;
            }
            if(await checkDuplicateChapter(chapterData.novelId, chapterData.chapterNumber)) {
                Swal.fire('ซ้ำ!', `ตอนที่ ${chapterData.chapterNumber} มีแล้ว`, 'error'); return;
            }

            const parentNovelRef = doc(db, 'novels', chapterData.novelId);
            try {
                if (currentEditingChapterId) {
                    await updateDoc(doc(db, 'chapters', currentEditingChapterId), chapterData);
                    await updateDoc(parentNovelRef, { lastChapterUpdatedAt: Timestamp.now() });
                    Swal.fire('สำเร็จ!', 'อัปเดตตอนแล้ว', 'success');
                } else {
                    chapterData.createdAt = Timestamp.now();
                    await addDoc(collection(db, 'chapters'), chapterData);
                    await updateDoc(parentNovelRef, { lastChapterUpdatedAt: Timestamp.now() });
                    Swal.fire('สำเร็จ!', 'เพิ่มตอนใหม่แล้ว', 'success');
                }
                window.setAdminChapterMode('add');
                loadNovels();
            } catch (error) { Swal.fire('Error', error.message, 'error'); }
        });
    }

    async function saveComment() {
        const message = document.getElementById('reader-comment-input').value;
        if (!currentUserData) { Swal.fire('Error', 'กรุณาเข้าสู่ระบบ', 'error'); return; }
        if (!message.trim()) return;
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
        } catch (error) { Swal.fire('Error', 'บันทึกไม่สำเร็จ', 'error'); }
    }
    const commentBtn = document.getElementById('reader-comment-post-btn');
    if(commentBtn) commentBtn.addEventListener('click', saveComment);

    const topupForm = document.getElementById('topup-form');
    if(topupForm) {
        topupForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            if (!currentUser) { Swal.fire('Error', 'กรุณาเข้าสู่ระบบ', 'error'); return; }
            const amount = document.getElementById('topup-amount').value;
            const time = document.getElementById('topup-time').value;
            if (!amount || !time) { Swal.fire('Warning', 'ข้อมูลไม่ครบ', 'warning'); return; }
            try {
                await addDoc(collection(db, "topup_requests"), {
                    userId: currentUser.uid,
                    username: currentUserData.username,
                    amount: parseInt(amount),
                    points: pointPackages[amount] || 0,
                    transferTime: time,
                    status: 'pending',
                    createdAt: Timestamp.now()
                });
                Swal.fire('สำเร็จ', 'แจ้งโอนแล้ว รอตรวจสอบ', 'success');
                topupForm.reset();
                document.getElementById('point-username').value = currentUserData.username;
                checkAdminNotifications();
            } catch (error) { Swal.fire('Error', 'ส่งข้อมูลไม่ได้', 'error'); }
        });
    }

    setupDonateForm();
    setupContactForm();

    const registerForm = document.getElementById('register-form');
    if(registerForm) {
        registerForm.addEventListener('submit', (e) => {
            e.preventDefault(); 
            const username = document.getElementById('reg-username').value.trim();
            const email = document.getElementById('reg-email').value.trim();
            const password = document.getElementById('reg-password').value;
            const confirmPassword = document.getElementById('reg-confirm-password') ? document.getElementById('reg-confirm-password').value : '';

            if (username.length < 4 || password.length < 6 || password !== confirmPassword) {
                 Swal.fire('ข้อมูลไม่ถูกต้อง', 'กรุณาตรวจสอบชื่อผู้ใช้หรือรหัสผ่าน', 'warning'); return;
            }

            createUserWithEmailAndPassword(auth, email, password)
                .then((userCredential) => {
                    return setDoc(doc(db, 'users', userCredential.user.uid), {
                        username: username, email: email, balancePoints: 0, role: 'user', 
                        createdAt: Timestamp.now(), likedNovels: [], unlockedChapters: [] 
                    });
                })
                .then(() => { Swal.fire('สำเร็จ', 'ยินดีต้อนรับ!', 'success'); window.showPage('page-home'); })
                .catch((error) => { Swal.fire('Error', error.message, 'error'); });
        });
    }

    const loginForm = document.getElementById('login-form');
    if(loginForm) {
        loginForm.addEventListener('submit', (e) => {
            e.preventDefault();
            signInWithEmailAndPassword(auth, document.getElementById('login-email').value, document.getElementById('login-password').value)
                .then(() => { window.showPage('page-home'); Swal.fire({ icon: 'success', title: 'เข้าสู่ระบบสำเร็จ', toast: true, position: 'top-end', showConfirmButton: false, timer: 2000 }); })
                .catch(() => { Swal.fire('Error', 'อีเมลหรือรหัสผ่านไม่ถูกต้อง', 'error'); });
        });
    }

    onAuthStateChanged(auth, user => {
        const loggedOutView = document.getElementById('auth-logged-out');
        const loggedInView = document.getElementById('auth-logged-in');
        const userUsername = document.getElementById('user-username');
        const userPoints = document.getElementById('user-points');
        const adminNotifyBtn = document.getElementById('admin-notify-btn');
        const adminTopupBtn = document.getElementById('admin-topup-btn');
        const adminSettingsBtn = document.getElementById('admin-settings-btn');
        const pointPageUsername = document.getElementById('point-username');
        const readerCommentUsername = document.getElementById('reader-comment-username');
        const commentInputBox = document.getElementById('comment-input-box');

        if (user) {
            currentUser = user; 
            getDoc(doc(db, 'users', user.uid)).then(docSnap => {
                if (docSnap.exists()) {
                    currentUserData = docSnap.data();
                    if(loggedOutView) loggedOutView.style.display = 'none';
                    if(loggedInView) loggedInView.style.display = 'flex';
                    if(userUsername) userUsername.textContent = currentUserData.username;
                    if(userPoints) userPoints.textContent = `${currentUserData.balancePoints} Points`;
                    if (pointPageUsername) { pointPageUsername.value = currentUserData.username; pointPageUsername.placeholder = ""; }
                    if (readerCommentUsername) readerCommentUsername.textContent = currentUserData.username;
                    if (commentInputBox) commentInputBox.style.display = 'block';
                    
                    if (currentUserData.role === 'admin') {
                        if(adminNotifyBtn) adminNotifyBtn.style.display = 'block';
                        if(adminTopupBtn) adminTopupBtn.style.display = 'block';
                        if(adminSettingsBtn) adminSettingsBtn.style.display = 'block';
                        checkAdminNotifications(); 
                    } else {
                        if(adminNotifyBtn) adminNotifyBtn.style.display = 'none';
                        if(adminTopupBtn) adminTopupBtn.style.display = 'none';
                        if(adminSettingsBtn) adminSettingsBtn.style.display = 'none';
                    }
                    loadNovels();
                } else { window.logout(); }
            }).catch(() => window.logout());
        } else {
            currentUser = null; currentUserData = null;
            if(loggedOutView) loggedOutView.style.display = 'flex';
            if(loggedInView) loggedInView.style.display = 'none';
            if(userUsername) userUsername.textContent = '...';
            if(userPoints) userPoints.textContent = '... Points';
            if(adminNotifyBtn) adminNotifyBtn.style.display = 'none';
            if(adminTopupBtn) adminTopupBtn.style.display = 'none';
            if(adminSettingsBtn) adminSettingsBtn.style.display = 'none';
            if (pointPageUsername) { pointPageUsername.value = ''; pointPageUsername.placeholder = "กรุณาเข้าสู่ระบบ"; }
            if (readerCommentUsername) readerCommentUsername.textContent = '...';
            if (commentInputBox) commentInputBox.style.display = 'none';
            loadNovels();
        }
    });
};

// ============================================================
//  5. COFFEE (DONATE) FUNCTIONS
// ============================================================

window.selectCoffee = function(amount) {
    document.querySelectorAll('.coffee-card').forEach(card => { card.classList.remove('selected'); });
    const selectedCard = document.getElementById(`cup-${amount}`);
    if(selectedCard) { selectedCard.classList.add('selected'); }
    const section = document.getElementById('donate-section');
    section.classList.remove('hidden');
    document.getElementById('donate-amount-display').textContent = `฿${amount}`;
    document.getElementById('donate-amount-val').value = amount;
    if (currentUserData) { document.getElementById('donate-name').value = currentUserData.username; }
    section.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

window.setupDonateForm = function() {
    const form = document.getElementById('donate-form');
    if(form) {
        form.addEventListener('submit', async (e) => {
            e.preventDefault();
            try {
                await addDoc(collection(db, "donations"), {
                    amount: parseInt(document.getElementById('donate-amount-val').value),
                    donorName: document.getElementById('donate-name').value,
                    message: document.getElementById('donate-message').value,
                    userId: currentUser ? currentUser.uid : null, 
                    createdAt: Timestamp.now(),
                    isReadByAdmin: false
                });
                Swal.fire({ title: 'ขอบคุณมากค่ะ! ❤️', confirmButtonColor: '#f97316', confirmButtonText: 'ด้วยความยินดี' });
                form.reset();
                document.getElementById('donate-section').classList.add('hidden');
                document.querySelectorAll('.coffee-card').forEach(c => c.classList.remove('selected'));
            } catch (error) { Swal.fire('Error', 'ส่งข้อมูลไม่สำเร็จ', 'error'); }
        });
    }
}

// ============================================================
//  6. CONTACT FORM & INBOX
// ============================================================
window.setupContactForm = function() {
    const contactForm = document.getElementById('contactForm');
    if (contactForm) {
        contactForm.addEventListener('submit', async function(e) { 
            e.preventDefault();
            try {
                Swal.fire({ title: 'กำลังส่ง...', didOpen: () => { Swal.showLoading(); } });
                await addDoc(collection(db, "contact_messages"), {
                    senderName: document.getElementById('name').value,
                    senderEmail: document.getElementById('email').value,
                    topic: document.getElementById('topic').value,
                    message: document.getElementById('message').value,
                    sentAt: Timestamp.now(), 
                    isReadByAdmin: false,     
                    userId: currentUser ? currentUser.uid : null, 
                    username: currentUserData ? currentUserData.username : 'Guest' 
                });
                Swal.fire({ icon: 'success', title: 'ส่งข้อความเรียบร้อย!', confirmButtonColor: '#6b21a8' });
                contactForm.reset();
                checkAdminNotifications();
            } catch (error) { Swal.fire('Error', 'ไม่สามารถส่งข้อความได้', 'error'); }
        });
    }
}

window.loadAdminInbox = async function() {
    const container = document.getElementById('admin-inbox-list');
    if (!db || !container) return;
    container.innerHTML = '<tr><td colspan="5" class="p-8 text-center text-gray-500">กำลังโหลด...</td></tr>';
    try {
        const q = query(collection(db, "contact_messages"));
        const querySnapshot = await getDocs(q);
        let messages = [];
        querySnapshot.forEach((doc) => { messages.push({ id: doc.id, ...doc.data() }); });
        messages.sort((a, b) => { if (a.isReadByAdmin === b.isReadByAdmin) { return b.sentAt - a.sentAt; } return a.isReadByAdmin ? 1 : -1; });
        container.innerHTML = '';
        if (messages.length === 0) { container.innerHTML = '<tr><td colspan="5" class="p-8 text-center">ไม่มีข้อความ</td></tr>'; return; }
        messages.forEach(msg => {
            const row = document.createElement('tr');
            row.className = msg.isReadByAdmin ? "bg-gray-50 text-gray-500" : "bg-white font-medium";
            row.innerHTML = `
                <td class="p-4 text-xs">${msg.sentAt.toDate().toLocaleString('th-TH')}</td>
                <td class="p-4 align-top"><div class="font-bold">${msg.senderName}</div><div class="text-xs">${msg.senderEmail}</div></td>
                <td class="p-4 align-top"><span class="bg-gray-100 px-2 py-1 rounded text-xs border">${msg.topic}</span></td>
                <td class="p-4 align-top max-w-xs"><p class="line-clamp-3">${msg.message}</p></td>
                <td class="p-4 text-center space-y-2">
                    ${!msg.isReadByAdmin ? `<button onclick="window.markMessageAsRead('${msg.id}')" class="w-full text-xs bg-green-500 text-white px-2 py-1 rounded">รับทราบ</button>` : ''}
                    <button onclick="window.deleteMessage('${msg.id}')" class="w-full text-xs bg-red-100 text-red-600 px-2 py-1 rounded">ลบ</button>
                </td>
            `;
            container.appendChild(row);
        });
    } catch (error) { container.innerHTML = '<tr><td colspan="5" class="text-red-500 text-center">โหลดไม่สำเร็จ</td></tr>'; }
}

window.markMessageAsRead = async function(msgId) {
    try {
        await updateDoc(doc(db, "contact_messages", msgId), { isReadByAdmin: true });
        const badge = document.getElementById('admin-inbox-badge');
        if (badge) { let count = parseInt(badge.textContent) || 0; count = Math.max(0, count - 1); if (count === 0) { badge.style.display = 'none'; } else { badge.textContent = count; } }
        window.loadAdminInbox();
    } catch (error) {}
}

window.deleteMessage = async function(msgId) {
    Swal.fire({ title: 'ลบข้อความ?', icon: 'warning', showCancelButton: true, confirmButtonColor: '#d33', confirmButtonText: 'ลบเลย' })
    .then(async (result) => {
        if (result.isConfirmed) {
            try { await deleteDoc(doc(db, "contact_messages", msgId)); window.checkAdminNotifications(); window.loadAdminInbox(); Swal.fire('ลบแล้ว', '', 'success'); } catch (error) {}
        }
    });
}
