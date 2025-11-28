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
    arrayUnion
} from "https://www.gstatic.com/firebasejs/9.6.1/firebase-firestore.js";

// ============================================================
// ⚠️ นำค่า Config เดิมของคุณมาวางทับตรงนี้ (ตรวจสอบลูกน้ำ , ให้ครบทุกบรรทัดนะคะ) ⚠️
// ============================================================
const firebaseConfig = {
    apiKey: "AIzaSyAEWniC7Ka-5a0lyBUuqhSswkNnYOd7wY4",
    authDomain: "linguaverse-novel.firebaseapp.com",
    projectId: "linguaverse-novel",
    storageBucket: "linguaverse-novel.firebasestorage.app",
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

// ตัวแปรสำคัญสำหรับเก็บข้อมูลจริงเพื่อใช้ในการค้นหา
let currentEditingNovelId = null;
let currentEditingChapterId = null;
let currentNovelChapters = [];

// ตารางคะแนน (บาท -> Points)
const pointPackages = {
    "25": 255,    
    "50": 515,    
    "75": 770,    
    "100": 1025, 
    "150": 1530  
};

// ============================================================
//  1. HELPER FUNCTIONS (จัดการ Dropdown และข้อมูลพื้นฐาน)
// ============================================================

async function loadNovelsForDropdown(elementId) {
    const selectEl = document.getElementById(elementId);
    const authorDatalist = document.getElementById('author-datalist'); 
    
    if (!db || !selectEl) return;
    
    const updateAuthorList = (novels) => {
        if (!authorDatalist) return;
        const authors = new Set();
        novels.forEach(n => {
            if (n.author) authors.add(n.author.trim());
        });
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
        novelCache = []; // รีเซ็ต Cache
        
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
            window.setAdminNovelMode('edit');
            Swal.fire('โหลดสำเร็จ', `กำลังแก้ไข "${novel.title_en}"`, 'success');
        } else {
            Swal.fire('ไม่พบข้อมูล', 'ไม่พบนิยายนี้ในฐานข้อมูล', 'error');
        }
    } catch (error) {
        Swal.fire('เกิดข้อผิดพลาด', error.message, 'error');
    }
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
        const q = query(collection(db, "chapters"), where("novelId", "==", novelId));
        const querySnapshot = await getDocs(q);
        let chapters = [];
        querySnapshot.forEach((doc) => {
            chapters.push({ id: doc.id, ...doc.data() });
        });
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
        console.error("Error loading chapters for dropdown:", error);
        selectEl.innerHTML = '<option value="">!! โหลดไม่สำเร็จ !!</option>';
    }
}

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
            window.setAdminChapterMode('edit');
            Swal.fire('โหลดสำเร็จ', `กำลังแก้ไข "${chapter.title}"`, 'success');
        } else {
            Swal.fire('ไม่พบข้อมูล', 'ไม่พบนิยายนี้ในฐานข้อมูล', 'error');
        }
    } catch (error) {
        console.log(error);
        Swal.fire('เกิดข้อผิดพลาด', error.message, 'error');
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
                <button onclick="window.markCommentAsRead('${comment.id}')" class="text-sm text-white bg-green-500 hover:bg-green-600 px-3 py-1 rounded-md">Mark as Read</button>
            `;
            container.appendChild(card);
        });
    } catch (error) {
        console.error("Error loading admin notifications:", error);
        container.innerHTML = '<p class="text-red-500 p-3">ไม่สามารถโหลดการแจ้งเตือนได้</p>';
    }
}

window.loadAdminTopupRequests = async function() {
    const container = document.getElementById('admin-topup-list');
    if (!db || !container) return;
    
    container.innerHTML = '<tr><td colspan="4" class="px-4 py-4 text-center text-gray-500">กำลังโหลดข้อมูล...</td></tr>';
    try {
        const q = query(collection(db, "topup_requests"), where("status", "==", "pending"));
        const querySnapshot = await getDocs(q);
        
        let requests = [];
        querySnapshot.forEach((doc) => {
            requests.push({ id: doc.id, ...doc.data() });
        });
        requests.sort((a, b) => a.createdAt - b.createdAt);
        
        container.innerHTML = '';
        if (requests.length === 0) {
            container.innerHTML = '<tr><td colspan="4" class="px-4 py-4 text-center text-gray-500">ไม่มีรายการรออนุมัติ</td></tr>';
            return;
        }

        requests.forEach(req => {
            const row = document.createElement('tr');
            const amountDisplay = `${req.amount} บาท (+${req.points} Points)`;
            const timeDisplay = new Date(req.transferTime).toLocaleString('th-TH');
            
            row.innerHTML = `
                <td class="px-4 py-3 text-sm text-gray-900">
                    <div class="font-medium">${req.username}</div>
                </td>
                <td class="px-4 py-3 text-sm text-gray-900 font-bold text-purple-600">
                    ${amountDisplay}
                </td>
                <td class="px-4 py-3 text-sm text-gray-500">
                    ${timeDisplay}
                </td>
                <td class="px-4 py-3 text-sm space-x-2">
                    <button onclick="window.approveTopup('${req.id}', '${req.userId}', ${req.points}, '${req.username}')" class="bg-green-500 text-white px-3 py-1 rounded hover:bg-green-600">อนุมัติ</button>
                    <button onclick="window.rejectTopup('${req.id}')" class="bg-red-500 text-white px-3 py-1 rounded hover:bg-red-600">ยกเลิก</button>
                </td>
            `;
            container.appendChild(row);
        });
    } catch (error) {
        console.error("Error loading topup requests:", error);
        container.innerHTML = '<tr><td colspan="4" class="px-4 py-4 text-center text-red-500">ไม่สามารถโหลดข้อมูลได้</td></tr>';
    }
}

window.approveTopup = async function(reqId, userId, points, username) {
    Swal.fire({
        title: 'ยืนยันการอนุมัติ?',
        text: `เติม ${points} Points ให้กับ ${username}`,
        icon: 'question',
        showCancelButton: true,
        confirmButtonText: 'อนุมัติเลย',
        cancelButtonText: 'เดี๋ยวก่อน'
    }).then(async (result) => {
        if (result.isConfirmed) {
            try {
                await updateDoc(doc(db, "topup_requests", reqId), {
                    status: 'completed',
                    approvedAt: Timestamp.now()
                });
                await updateDoc(doc(db, "users", userId), {
                    balancePoints: increment(points)
                });
                Swal.fire('สำเร็จ!', 'เติม Points เรียบร้อยแล้ว', 'success');
                window.loadAdminTopupRequests();
                checkAdminNotifications();
            } catch (error) {
                console.error("Error approving topup:", error);
                Swal.fire('Error', 'เกิดข้อผิดพลาดในการอนุมัติ', 'error');
            }
        }
    });
}

window.rejectTopup = async function(reqId) {
    Swal.fire({
        title: 'ยืนยันการยกเลิก?',
        text: "รายการนี้จะไม่ได้รับ Points",
        icon: 'warning',
        showCancelButton: true,
        confirmButtonColor: '#d33',
        confirmButtonText: 'ยกเลิกรายการ',
        cancelButtonText: 'ปิด'
    }).then(async (result) => {
        if (result.isConfirmed) {
            try {
                await updateDoc(doc(db, "topup_requests", reqId), {
                    status: 'rejected',
                    rejectedAt: Timestamp.now()
                });
                Swal.fire('ยกเลิกแล้ว', 'รายการถูกปฏิเสธ', 'info');
                window.loadAdminTopupRequests();
                checkAdminNotifications();
            } catch (error) {
                console.error("Error rejecting topup:", error);
                Swal.fire('Error', 'เกิดข้อผิดพลาด', 'error');
            }
        }
    });
}

// ============================================================
//  [UPDATED] CORE FUNCTION: Load Novels (Real Data + New Design)
// ============================================================
async function loadNovels() {
    if (!db) return;
    const containers = {
        'KR': document.getElementById('novel-container-kr'),
        'CN': document.getElementById('novel-container-cn'),
        'EN': document.getElementById('novel-container-en'),
        'JP': document.getElementById('novel-container-jp')
    };
    ['KR', 'CN', 'EN', 'JP'].forEach(lang => {
        if(containers[lang]) containers[lang].innerHTML = ''; 
        const loadingText = document.getElementById(`novel-loading-${lang.toLowerCase()}`);
        if (loadingText) loadingText.style.display = 'block'; 
    });
    const homeUpdatesContainer = document.getElementById('home-latest-updates');
    if(homeUpdatesContainer) homeUpdatesContainer.innerHTML = ''; 
    
    try {
        // ดึงข้อมูลจริงจาก Firebase
        const querySnapshot = await getDocs(collection(db, "novels"));
        let allNovels = [];
        novelCache = []; 
        querySnapshot.forEach((doc) => {
            allNovels.push({ id: doc.id, ...doc.data() });
        });
        // เก็บ Cache ไว้สำหรับการค้นหา
        novelCache = allNovels;
        // เรียงลำดับตามวันที่อัปเดตล่าสุด
        allNovels.sort((a, b) => {
            const timeA = a.lastChapterUpdatedAt ? (a.lastChapterUpdatedAt.toDate ? a.lastChapterUpdatedAt.toDate().getTime() : 0) : 0;
            const timeB = b.lastChapterUpdatedAt ? (b.lastChapterUpdatedAt.toDate ? b.lastChapterUpdatedAt.toDate().getTime() : 0) : 0;
            return timeB - timeA;
        });
        const timeAgoLimit = Date.now() - (3 * 24 * 60 * 60 * 1000); // 3 วัน
        let novelCount = { KR: 0, CN: 0, EN: 0, JP: 0 };
        allNovels.forEach(novel => {
            const novelId = novel.id;
            const lang = novel.language ? novel.language.toUpperCase() : 'OTHER'; 
            
            if (containers[lang]) {
                novelCount[lang]++;
                const card = document.createElement('div');
                
                // --- [NEW DESIGN] การ์ดนิยายแบบสวยงาม ---
                card.className = "novel-card group cursor-pointer relative";
                card.setAttribute('onclick', `window.showNovelDetail('${novelId}', '${novel.status}')`); 
                
                // Logic Badge (ลิขสิทธิ์ & New)
                let licensedBadge = '';
                if (novel.isLicensed) {
                    licensedBadge = '<span class="absolute top-2 left-2 bg-red-600 text-white text-xs font-bold px-2 py-1 rounded shadow">ลิขสิทธิ์</span>';
                }
                let newBadge = '';
                let isNew = false;
                if (novel.lastChapterUpdatedAt && (novel.lastChapterUpdatedAt.toDate ? novel.lastChapterUpdatedAt.toDate().getTime() : 0) > timeAgoLimit) {
                    newBadge = '<span class="absolute top-2 right-2 bg-purple-600 text-white text-xs font-bold px-2 py-1 rounded animate-pulse shadow">NEW</span>';
                    isNew = true;
                }

                // Rating & Category (Safe check)
                const rating = novel.rating || '5.0';
                const category = (novel.categories && novel.categories.length > 0) ? novel.categories[0] : 'นิยาย';
                // HTML Structure ของการ์ดแบบใหม่
                card.innerHTML = `
                    <div class="relative overflow-hidden h-64">
                        <img src="${novel.coverImageUrl || 'https://placehold.co/300x450'}" alt="${novel.title_en}" class="w-full h-full object-cover transition-transform duration-500 group-hover:scale-110">
                        ${licensedBadge}
                        ${newBadge}
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
                
                // Update Home List (เฉพาะ 4 เรื่องแรกที่ใหม่สุด)
                if (homeUpdatesContainer && homeUpdatesContainer.childElementCount < 4) {
                     const homeCard = document.createElement('div');
                     homeCard.className = "flex items-center space-x-4 p-3 hover:bg-purple-50 rounded-lg transition-colors cursor-pointer border-b border-gray-100 last:border-0";
                     homeCard.onclick = () => window.showNovelDetail(novelId, novel.status);
                     
                     // เวลาอัปเดต (แปลง timestamp เป็น string)
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
        // Hide Loading & Show Empty State
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
        // Refresh Icons
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

// ============================================================
//  [UPDATED] Filter Novels (ใช้ดีไซน์ใหม่ + ข้อมูลจริง)
// ============================================================
window.filterNovels = function() {
    const searchText = document.getElementById('search-input').value.toLowerCase();
    const statusFilter = document.getElementById('filter-status').value;
    const categoryFilter = document.getElementById('filter-category').value;

    const containers = {
        'KR': document.getElementById('novel-container-kr'),
        'CN': document.getElementById('novel-container-cn'),
        'EN': document.getElementById('novel-container-en'),
        'JP': document.getElementById('novel-container-jp')
    };
    // Clear all containers first
    for(let key in containers) {
        if(containers[key]) containers[key].innerHTML = '';
    }

    const timeAgoLimit = Date.now() - (3 * 24 * 60 * 60 * 1000);
    let hasResults = { 'KR': false, 'CN': false, 'EN': false, 'JP': false };
    // ใช้ novelCache (ข้อมูลจริง) ในการค้นหา
    novelCache.forEach(novel => {
        // Filter Logic
        const matchText = novel.title_en.toLowerCase().includes(searchText) || 
                          (novel.title_th && novel.title_th.includes(searchText));
        const matchStatus = statusFilter === "" || novel.status === statusFilter;
        const matchCategory = categoryFilter === "" || (novel.categories && novel.categories.includes(categoryFilter));

        if (matchText && matchStatus && matchCategory) {
            const lang = novel.language ? novel.language.toUpperCase() : 'OTHER';
            if (containers[lang]) {
                hasResults[lang] = true;
                const card = document.createElement('div');
                card.className = "novel-card group cursor-pointer relative";
                card.setAttribute('onclick', `window.showNovelDetail('${novel.id}', '${novel.status}')`);
                let licensedBadge = '';
                if (novel.isLicensed) {
                    licensedBadge = '<span class="absolute top-2 left-2 bg-red-600 text-white text-xs font-bold px-2 py-1 rounded shadow">ลิขสิทธิ์</span>';
                }
                let newBadge = '';
                if (novel.lastChapterUpdatedAt && (novel.lastChapterUpdatedAt.toDate ? novel.lastChapterUpdatedAt.toDate().getTime() : 0) > timeAgoLimit) {
                    newBadge = '<span class="absolute top-2 right-2 bg-purple-600 text-white text-xs font-bold px-2 py-1 rounded animate-pulse shadow">NEW</span>';
                }
                const rating = novel.rating || '5.0';
                const category = (novel.categories && novel.categories.length > 0) ? novel.categories[0] : 'นิยาย';
                card.innerHTML = `
                    <div class="relative overflow-hidden h-64">
                        <img src="${novel.coverImageUrl || 'https://placehold.co/300x450'}" alt="${novel.title_en}" class="w-full h-full object-cover transition-transform duration-500 group-hover:scale-110">
                        ${licensedBadge}
                        ${newBadge}
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
    // Show "Not Found" message if empty
    for(let key in containers) {
        if(!hasResults[key] && containers[key]) {
            containers[key].innerHTML = '<p class="text-gray-400 col-span-full text-center py-4">ไม่พบนิยายที่ค้นหา...</p>';
        }
    }
    if (window.lucide) window.lucide.createIcons();
}

// ============================================================
//  2. STANDARD FUNCTIONS (Admin, Comments, Details - คงเดิมไว้)
// ============================================================

// [UPDATED] Check Admin Notifications (ซ่อนเลข 0 อย่างสมบูรณ์ 100%)
async function checkAdminNotifications() {
    if (!db || !currentUserData || currentUserData.role !== 'admin') {
        return;
    }
    
    // Elements
    const commentBadge = document.getElementById('admin-notify-badge');
    const topupBadge = document.getElementById('admin-topup-badge');
    const inboxBadge = document.getElementById('admin-inbox-badge');
    const inboxBtn = document.getElementById('admin-inbox-btn');

    if(inboxBtn) inboxBtn.style.display = 'block';

    try {
        // 1. Check Comments
        const qComment = query(collection(db, "comments"), where("isReadByAdmin", "==", false));
        const snapComment = await getDocs(qComment);
        if (commentBadge) {
            const count = snapComment.size;
            if (count > 0) {
                commentBadge.textContent = count > 9 ? '9+' : count;
                commentBadge.classList.remove('hidden');
                commentBadge.style.display = ''; // Reset display
            } else {
                commentBadge.classList.add('hidden');
                commentBadge.style.display = 'none'; // Force hide
                commentBadge.textContent = ''; // Clear text
            }
        }

        // 2. Check Pending Topups
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

        // 3. Check Contact Messages
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

    } catch (error) {
        console.error("Error checking admin notifications:", error);
    }
}

async function loadAuthorOtherWorks(authorName, currentId) {
    const container = document.getElementById('detail-other-works');
    if(!container) return;
    container.innerHTML = '<div class="p-2 text-gray-400 text-sm animate-pulse">กำลังค้นหาผลงานอื่น...</div>';
    try {
        const q = query(collection(db, "novels"), where("author", "==", authorName));
        const querySnapshot = await getDocs(q);
        const otherWorks = [];
        querySnapshot.forEach((doc) => {
            if (doc.id !== currentId) {
                otherWorks.push({ id: doc.id, ...doc.data() });
            }
        });
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
            img.alt = work.title_en;
            imgWrapper.onclick = (e) => {
                e.stopPropagation(); 
                window.openImageModal(work.coverImageUrl);
            };
            imgWrapper.appendChild(img);
            const title = document.createElement('span');
            title.className = "text-xs text-center font-medium text-gray-600 line-clamp-2 group-hover:text-purple-600 cursor-pointer transition-colors";
            title.textContent = work.title_en;
            title.onclick = () => {
                window.showNovelDetail(work.id, work.status);
                window.scrollToTop();
            };
            item.appendChild(imgWrapper);
            item.appendChild(title);
            container.appendChild(item);
        });
    } catch (error) {
        console.error("Error loading other works:", error);
        container.innerHTML = '<div class="p-2 text-red-400 text-sm">ไม่สามารถโหลดข้อมูลได้</div>';
    }
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
    } catch (error) {
        console.error("Error checking like status", error);
        likeBtn.disabled = false;
    }
}

// --- Load Novel Details with Read More Logic ---
async function loadNovelDetails(novelId) {
    if (!db || !novelId) return;
    document.getElementById('detail-cover-img').src = 'https://placehold.co/400x600/C4B5FD/FFFFFF?text=Loading...';
    document.getElementById('detail-title-en').textContent = 'กำลังโหลดชื่อเรื่อง...';
    document.getElementById('detail-title-th').textContent = '...';
    document.getElementById('detail-author').textContent = '...';
    document.getElementById('detail-language').textContent = '...';
    document.getElementById('detail-status').textContent = '...';
    document.getElementById('detail-chapters-count').textContent = '...'; 
    
    // Reset Description & Button
    const descEl = document.getElementById('detail-description');
    const toggleBtn = document.getElementById('toggle-desc-btn');
    descEl.innerHTML = '<p>กำลังโหลดเรื่องย่อ...</p>';
    descEl.className = "text-gray-600 novel-content mb-2 transition-all duration-300";
    if(toggleBtn) {
        toggleBtn.classList.add('hidden');
        toggleBtn.textContent = 'อ่านต่อ... (Read More)'; 
    }

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
            // --- ส่วนจัดการเรื่องย่อ (ใหม่) ---
            descEl.innerHTML = novel.description || "ไม่มีเรื่องย่อ";
            // ตรวจสอบความสูงของเนื้อหา
            setTimeout(() => {
                if (descEl.scrollHeight > 180) {
                    descEl.classList.add('desc-truncated');
                    if(toggleBtn) {
                        toggleBtn.classList.remove('hidden');
                        toggleBtn.textContent = 'อ่านต่อ... (Read More) ▼';
                    }
                } else {
                   descEl.classList.remove('desc-truncated');
                }
            }, 50);
            // --------------------------------

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
            loadAuthorOtherWorks(novel.author, novelId);
            checkUserLikeStatus(novelId, novel.totalLikes || 0);
            if (window.lucide) lucide.createIcons();
        } else {
            console.error("No such novel document!");
            document.getElementById('detail-title-en').textContent = 'ไม่พบนิยายนี้';
        }
    } catch (error) {
        console.error("Error getting novel details: ", error);
        document.getElementById('detail-title-en').textContent = 'เกิดข้อผิดพลาด';
    }
}

function getChapterBadge(pointCost, type, isUnlocked) {
    if (isUnlocked) {
        return `<span class="text-sm font-bold px-2 py-1 rounded" style="background-color: #4ade80; color: #065f46; box-shadow: 0 1px 2px rgba(0,0,0,0.1);">ซื้อแล้ว (อ่านเลย)</span>`;
    }

    if (pointCost === 0) return `<span class="text-sm font-medium px-2 py-1 rounded" style="color: #778899; border: 1px solid #778899;">อ่านฟรี</span>`;
    if (pointCost === 5) return `<span class="text-sm font-medium px-2 py-1 rounded" style="background-color: #00bfff; color: white;">${pointCost} Points</span>`;
    if (pointCost === 10) return `<span class="text-sm font-medium px-2 py-1 rounded" style="background-color: #1e90ff; color: white;">${pointCost} Points</span>`;
    if (type === 'Side') return `<span class="text-sm font-medium px-2 py-1 rounded" style="background-color: #228b22; color: white;">${pointCost} Points</span>`;
    if (type === 'Special') return `<span class="text-sm font-medium px-2 py-1 rounded" style="background-color: #ff69b4; color: white;">${pointCost} Points</span>`;
    if (type === 'Extra') return `<span class="text-sm font-medium px-2 py-1 rounded" style="background-color: #ff7f50; color: white;">${pointCost} Points</span>`;
    if (type === 'NC') return `<span class="text-sm font-medium px-2 py-1 rounded" style="background-color: #ff3b3b; color: white;">${pointCost} Points</span>`;
    return `<span class="text-sm font-medium px-2 py-1 rounded" style="background-color: #1e90ff; color: white;">${pointCost} Points</span>`;
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
        
        const now = new Date();
        const isAdmin = currentUserData && currentUserData.role === 'admin';
        // Filter chapters
        const visibleChapters = chapters.filter(chapter => {
            const scheduledDate = chapter.scheduledAt ? chapter.scheduledAt.toDate() : new Date(0); 
            if (isAdmin) return true; // Admin sees everything
            return scheduledDate <= now; // User sees only released chapters
        });
        chaptersCountEl.textContent = `${visibleChapters.length} ตอน`;
        chapterListContainer.innerHTML = '';
        if (visibleChapters.length === 0) {
            chapterListContainer.innerHTML = '<div class="p-3 text-gray-500">ยังไม่มีตอน...</div>';
            return;
        }

        let unlockedChapters = [];
        if (currentUserData && currentUserData.unlockedChapters) {
            unlockedChapters = currentUserData.unlockedChapters;
        }

        visibleChapters.forEach(chapter => {
            const chapterId = chapter.id;
            const isUnlocked = unlockedChapters.includes(chapterId);
            
            let scheduleBadge = '';
            const scheduledDate = chapter.scheduledAt ? chapter.scheduledAt.toDate() : new Date(0);
            if (isAdmin && scheduledDate > now) {
                scheduleBadge = ' <span class="text-xs text-red-500 font-bold border border-red-500 px-1 rounded">⏳ รอเผยแพร่</span>';
            }

            const chapterEl = document.createElement('div');
            chapterEl.className = "flex justify-between items-center p-3 hover:bg-gray-50 cursor-pointer";
            chapterEl.onclick = () => window.showReaderPage(chapterId, chapter.pointCost);
             const titleSpan = `<span class="text-gray-800">ตอนที่ ${chapter.chapterNumber}: ${chapter.title}${scheduleBadge}</span>`;
            const badgeSpan = getChapterBadge(chapter.pointCost, chapter.type, isUnlocked);
            chapterEl.innerHTML = titleSpan + badgeSpan;
            chapterListContainer.appendChild(chapterEl);
        });
    } catch (error) {
        console.error("Error loading chapters: ", error);
        chapterListContainer.innerHTML = '<div class="p-3 text-red-500">ไม่สามารถโหลดสารบัญได้</div>';
    }
}

async function loadAndShowNovelDetail(novelId) {
    window.showPage('page-novel-detail');
    await Promise.all([
        loadNovelDetails(novelId),
        loadNovelChapters(novelId)
    ]);
}

async function loadNovelChapterList(novelId) {
    if (!db || !novelId) return;
    if (currentNovelChapters.length > 0 && currentNovelChapters[0].novelId === novelId) return;
    
    try {
        const q = query(collection(db, "chapters"), where("novelId", "==", novelId));
        const querySnapshot = await getDocs(q);
        currentNovelChapters = [];
        querySnapshot.forEach((doc) => {
            currentNovelChapters.push({ id: doc.id, novelId: novelId, ...doc.data() });
        });
        currentNovelChapters.sort((a, b) => a.chapterNumber - b.chapterNumber); 
    } catch (error) {
        console.error("Error caching novel chapters:", error);
        currentNovelChapters = []; 
    }
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
    console.log(`Loading content for chapter ${chapterId}`);
    const readerTitle = document.getElementById('reader-title');
    const readerChapterTitle = document.getElementById('reader-chapter-title');
    const readerContentDiv = document.getElementById('reader-content-div');
    const navButtons = document.getElementById('reader-navigation-buttons'); 
    if (navButtons) navButtons.innerHTML = '';
    const currentNovel = novelCache.find(n => n.id === currentOpenNovelId);
    readerTitle.textContent = currentNovel ? currentNovel.title_en : 'กำลังโหลด...';
    readerChapterTitle.textContent = '...';
    readerContentDiv.innerHTML = '<p>กำลังโหลดเนื้อหา...</p>';
    
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
                readerContentDiv.innerHTML = `
                    <div class="text-center p-10">
                        <h3 class="text-xl font-bold text-red-500 mb-2">⚠️ ตอนนี้ยังไม่เผยแพร่</h3>
                        <p class="text-gray-600">กรุณารอจนถึงเวลาที่กำหนด</p>
                        <p class="text-sm text-gray-400 mt-2">เผยแพร่เมื่อ: ${scheduledDate.toLocaleString()}</p>
                    </div>
                `;
                createReaderNavigation(chapterId);
                return;
            }

            readerChapterTitle.textContent = `ตอนที่ ${chapter.chapterNumber}: ${chapter.title}`;
            readerContentDiv.innerHTML = chapter.content;
            currentOpenChapterTitle = chapter.title; 
            createReaderNavigation(chapterId);
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

// --- โหลดคอมเมนต์ ---
async function loadComments(chapterId) {
    const container = document.getElementById('reader-comment-container');
    if (!db || !container) return;
    
    container.innerHTML = '<p class="text-gray-500 p-3">กำลังโหลดคอมเมนต์...</p>';
    try {
        const q = query(collection(db, "comments"), where("chapterId", "==", chapterId));
        const querySnapshot = await getDocs(q);
        let allComments = [];
        querySnapshot.forEach((doc) => {
            allComments.push({ id: doc.id, ...doc.data() });
        });
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
            replies.forEach(reply => {
                container.innerHTML += createCommentHTML(reply, true);
            });
        });
    } catch (error) {
        console.error("Error loading comments:", error);
        container.innerHTML = '<p class="text-red-500 p-3">ไม่สามารถโหลดคอมเมนต์ได้</p>';
    }
}

// --- ฟังก์ชัน Comment Like & Reply ---
window.toggleCommentLike = async function(commentId) {
    if (!currentUser) {
        Swal.fire('กรุณาเข้าสู่ระบบ', 'ต้อง Login ก่อนกด Like นะคะ', 'warning');
        return;
    }
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
    } catch (error) {
        console.error("Error toggling comment like:", error);
    }
}

window.toggleReplyBox = function(commentId) {
    const box = document.getElementById(`reply-box-${commentId}`);
    if (box) {
        if (box.classList.contains('hidden')) {
            box.classList.remove('hidden');
            setTimeout(() => document.getElementById(`reply-input-${commentId}`).focus(), 100);
        } else {
            box.classList.add('hidden');
        }
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
    } catch (error) {
        console.error("Error submitting reply:", error);
        Swal.fire('Error', 'ส่งข้อความตอบกลับไม่สำเร็จ', 'error');
    }
}

// ============================================================
//  3. WINDOW FUNCTIONS (Navigation & Helpers)
// ============================================================

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
        window.setAdminNovelMode('add');
    }
    if (pageId === 'page-admin-add-chapter') {
        loadNovelsForDropdown('chapter-novel-select'); 
        loadNovelsForDropdown('edit-chapter-novel-select');
        window.setAdminChapterMode('add');
    }
    if (pageId === 'page-admin-notifications') {
        loadAdminNotifications();
    }
    if (pageId === 'page-admin-topup') {
        loadAdminTopupRequests();
    }
    if (pageId === 'page-admin-inbox') {  // <--- เพิ่มเงื่อนไขนี้เพื่อให้โหลดกล่องข้อความ
        loadAdminInbox();
    }
    if (window.scrollToTop) window.scrollToTop();
    if (window.lucide) window.lucide.createIcons();
}

window.formatDoc = function(cmd, editorId = 'novel-description-editor', value = null) {
    const editor = document.getElementById(editorId);
    if (editor) {
        document.execCommand(cmd, false, value); 
        editor.focus();
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
    const deleteBtn = document.getElementById('admin-delete-novel-btn'); // <--- ปุ่มลบ

    if (mode === 'add') {
        currentEditingNovelId = null; 
        form.reset();
        document.getElementById('novel-description-editor').innerHTML = '';
        document.querySelectorAll('.novel-category-check').forEach(cb => cb.checked = false);
        title.textContent = "เพิ่มนิยายใหม่";
        saveBtnText.textContent = "Save New";
        tabBtn.classList.add('bg-purple-600', 'text-white');
        tabBtn.classList.remove('bg-gray-200', 'text-gray-700');
        
        if(deleteBtn) deleteBtn.classList.add('hidden'); // ซ่อนปุ่มลบตอนเพิ่มใหม่

    } else if (mode === 'edit') {
        title.textContent = `กำลังแก้ไข: ${document.getElementById('novel-title-en').value}`;
        saveBtnText.textContent = "Update Novel";
        tabBtn.classList.remove('bg-purple-600', 'text-white');
        tabBtn.classList.add('bg-gray-200', 'text-gray-700');

        if(deleteBtn) deleteBtn.classList.remove('hidden'); // แสดงปุ่มลบตอนแก้ไข
    }
}

// [NEW] Function to Delete Novel
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
                // 1. ลบเอกสารนิยายจาก Collection 'novels'
                await deleteDoc(doc(db, "novels", currentEditingNovelId));

                // 2. (Optional) ลบ Chapters ที่เกี่ยวข้อง (เพื่อความสะอาดของ DB)
                // หมายเหตุ: การลบแบบนี้อาจต้องทำ Batch Delete ถ้ามีตอนเยอะมากๆ แต่เบื้องต้นเอาแค่นี้ก่อน
                const q = query(collection(db, "chapters"), where("novelId", "==", currentEditingNovelId));
                const querySnapshot = await getDocs(q);
                querySnapshot.forEach(async (doc) => {
                    await deleteDoc(doc.ref);
                });

                Swal.fire('ลบเรียบร้อย!', 'นิยายถูกลบออกจากระบบแล้ว', 'success');
                
                // 3. รีเซ็ตหน้าจอ
                window.setAdminNovelMode('add');
                loadNovels(); // โหลดรายการนิยายใหม่

            } catch (error) {
                console.error("Error deleting novel:", error);
                Swal.fire('เกิดข้อผิดพลาด', 'ไม่สามารถลบนิยายได้', 'error');
            }
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
    if(modal) {
        modal.classList.add('hidden');
        modal.classList.remove('flex');
    }
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
            window.showPage('page-login');
        });
        return;
    }

    if (currentUserData.role === 'admin') {
        loadChapterContent(chapterId);
        return;
    }
    
    if (currentUserData.unlockedChapters && currentUserData.unlockedChapters.includes(chapterId)) {
        loadChapterContent(chapterId);
        return;
    }

    if (pointCost === 0) {
        loadChapterContent(chapterId);
    } else {
        window.showPointAlert(chapterId, pointCost);
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
            window.showPage('page-add-point');
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
                    balancePoints: newPoints,
                    unlockedChapters: arrayUnion(chapterId) 
                });

                currentUserData.balancePoints = newPoints;
                if (!currentUserData.unlockedChapters) currentUserData.unlockedChapters = [];
                currentUserData.unlockedChapters.push(chapterId);
                document.getElementById('user-points').textContent = `${newPoints} Points`;
                Swal.fire('หัก Point สำเร็จ!', `ระบบหัก ${pointCost} Points. คุณมี ${newPoints} Points`, 'success');
                loadChapterContent(chapterId);
            } catch (error) {
                console.error("Error updating points: ", error);
                Swal.fire('เกิดข้อผิดพลาด', 'ไม่สามารถหัก Point ได้', 'error');
            }
        }
    });
}

window.toggleNovelLike = async function() {
    if (!currentUser) {
        Swal.fire({
            icon: 'info',
            title: 'กรุณาเข้าสู่ระบบ',
            text: 'คุณต้องเข้าสู่ระบบก่อนจึงจะกด Like ได้',
            confirmButtonColor: '#8B5CF6',
            confirmButtonText: 'ไปหน้า Login'
        }).then(() => window.showPage('page-login'));
        return;
    }
    if (!currentOpenNovelId) return;
    const likeBtn = document.getElementById('detail-like-btn');
    likeBtn.disabled = true;
    const novelDocRef = doc(db, 'novels', currentOpenNovelId);
    const likeDocRef = doc(db, 'users', currentUser.uid, 'likedNovels', currentOpenNovelId);
    try {
        const isLiked = likeBtn.getAttribute('data-liked') === 'true';
        if (isLiked) {
            await deleteDoc(likeDocRef);
            await updateDoc(novelDocRef, {
                totalLikes: increment(-1) 
            });
        } else {
            await setDoc(likeDocRef, { likedAt: Timestamp.now() });
            await updateDoc(novelDocRef, {
                totalLikes: increment(1)
            });
        }
        const novelSnap = await getDoc(novelDocRef);
        checkUserLikeStatus(currentOpenNovelId, novelSnap.data().totalLikes);
    } catch (error) {
        console.error("Error toggling like:", error);
        Swal.fire('เกิดข้อผิดพลาด', error.message, 'error');
        likeBtn.disabled = false;
    }
}

// [UPDATED] Mark Comment As Read (Fix 0 Issue)
window.markCommentAsRead = async function(commentId) {
    if (!db) return;
    const card = document.getElementById(`comment-card-${commentId}`);
    if (card) {
        card.style.transition = "opacity 0.3s";
        card.style.opacity = "0";
        setTimeout(() => card.style.display = 'none', 300);
    }
    const badge = document.getElementById('admin-notify-badge');
    if (badge) {
        let currentCount = parseInt(badge.innerText) || 0;
        if (isNaN(currentCount)) currentCount = 0;
        if (currentCount > 0) {
            const newCount = currentCount - 1;
            if (newCount <= 0) {
                badge.classList.add('hidden');
                badge.style.display = 'none'; // Force hide
                badge.innerText = ''; // Clear text
                
                const container = document.getElementById('admin-notify-container');
                if(container && container.children.length <= 1) { 
                     container.innerHTML = '<p class="text-gray-500 p-3 text-center">ไม่มีคอมเมนต์ที่ยังไม่อ่าน</p>';
                }
            } else {
                badge.innerText = newCount > 9 ? '9+' : newCount;
            }
        }
    }
    try {
        const commentDocRef = doc(db, 'comments', commentId);
        await updateDoc(commentDocRef, {
            isReadByAdmin: true
        });
    } catch (error) {
        console.error("Error marking comment as read:", error);
        if (card) {
            card.style.display = 'block';
            card.style.opacity = '1';
        }
    }
}

window.showNovelDetail = function(novelId, status) { 
    currentOpenNovelId = novelId;
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

window.logout = function() { 
    signOut(auth).then(() => {
        currentUser = null;
        currentUserData = null;
        window.showPage('page-home');
    }).catch((error) => {
        console.error("Logout Error:", error);
    });
}

// ============================================================
//  4. INITIALIZATION & EVENT LISTENERS
// ============================================================

window.onload = function() {
    try {
        if (window.lucide) window.lucide.createIcons();
    } catch (error) {
        console.error("Lucide error:", error);
    }
    
    try {
        // เช็คว่ามีการใส่ Config หรือยัง
        if (firebaseConfig.apiKey === "xxx" || firebaseConfig.apiKey.includes("นำรหัส")) {
            Swal.fire('Config Error', 'กรุณาใส่ Firebase Config ในไฟล์ app.js บรรทัดบนสุด', 'error');
            throw new Error("Missing Firebase Config");
        }
        
        app = initializeApp(firebaseConfig);
        auth = getAuth(app);
        db = getFirestore(app);
        console.log("Firebase initialized successfully!");
    } catch (error) {
        console.error("Firebase initialization failed:", error);
        return;
    }
    
    // --- Protection: ป้องกันคลิกขวาและการ Copy ---
    document.addEventListener('contextmenu', function(e) {
        // ป้องกันเฉพาะส่วนที่เป็นการอ่านนิยาย หรือรูปภาพ
        if (e.target.closest('.novel-read-container') || e.target.tagName === 'IMG') {
            e.preventDefault();
            return false;
        }
    });
    document.onkeydown = function(e) {
        if (e.ctrlKey || e.metaKey) {
            if (['c', 'x', 'u', 's'].includes(e.key.toLowerCase())) {
                 if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.isContentEditable) {
                     return true;
                 }
                 e.preventDefault();
                 return false;
            }
        }
    };
    // ---------------------------------------------

    function setupPasswordToggle(btnId, inputId, iconId) {
        const btn = document.getElementById(btnId);
        const input = document.getElementById(inputId);
        const icon = document.getElementById(iconId);
        if (btn && input && icon) {
            btn.addEventListener('click', (e) => {
                e.preventDefault();
                const type = input.getAttribute('type') === 'password' ? 'text' : 'password';
                input.setAttribute('type', type);
                if (type === 'text') {
                    icon.setAttribute('data-lucide', 'eye');
                } else {
                    icon.setAttribute('data-lucide', 'eye-off');
                }
                if (window.lucide) window.lucide.createIcons();
            });
        }
    }

    setupPasswordToggle('reg-toggle-password', 'reg-password', 'reg-toggle-icon');
    setupPasswordToggle('login-toggle-password', 'login-password', 'login-toggle-icon');
    
    const loadNovelEditBtn = document.getElementById('load-novel-to-edit-btn');
    if(loadNovelEditBtn) loadNovelEditBtn.addEventListener('click', loadNovelForEditing);

    // --- [NEW] Event Listener สำหรับปุ่มลบนิยาย ---
    const deleteNovelBtn = document.getElementById('admin-delete-novel-btn');
    if(deleteNovelBtn) {
        deleteNovelBtn.addEventListener('click', window.deleteCurrentNovel);
    }
    // -----------------------------------------------

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
                    const novelDocRef = doc(db, 'novels', currentEditingNovelId);
                    await updateDoc(novelDocRef, novelData);
                    Swal.fire('อัปเดตสำเร็จ!', `นิยายเรื่อง "${novelData.title_en}" ถูกอัปเดตแล้ว`, 'success');
                    loadNovels(); 
                    window.setAdminNovelMode('add');
                } else {
                    novelData.totalLikes = 0;
                    novelData.createdAt = Timestamp.now();
                    novelData.lastChapterUpdatedAt = Timestamp.now();
                    await addDoc(collection(db, 'novels'), novelData);
                    Swal.fire('เพิ่มนิยายสำเร็จ!', `นิยายเรื่อง "${novelData.title_en}" ถูกบันทึกแล้ว`, 'success');
                    loadNovels(); 
                    window.setAdminNovelMode('add');
                }
            } catch (error) {
                Swal.fire('เกิดข้อผิดพลาด', error.message, 'error');
            }
        });
    }

    const editChapterNovelSelect = document.getElementById('edit-chapter-novel-select');
    if(editChapterNovelSelect) {
        editChapterNovelSelect.addEventListener('change', (e) => {
            loadChaptersForEditDropdown(e.target.value);
        });
    }
    
    const loadChapterEditBtn = document.getElementById('load-chapter-to-edit-btn');
    if(loadChapterEditBtn) loadChapterEditBtn.addEventListener('click', loadChapterForEditing);
    // ============================================================
    // [NEW] Logic to check duplicate chapters
    // ============================================================
    const checkDuplicateChapter = async (novelId, chapterNum) => {
        if(!novelId || isNaN(chapterNum)) return false;
        const q = query(collection(db, "chapters"),
            where("novelId", "==", novelId),
            where("chapterNumber", "==", chapterNum)
        );
        const snap = await getDocs(q);
        if(snap.empty) return false;

        // ถ้ามีข้อมูล ต้องเช็คว่าเป็นตัวเดียวกับที่กำลังแก้หรือไม่
        let isDup = false;
        snap.forEach(doc => {
            // ถ้ากำลังแก้ไข และ id ตรงกับตัวที่กำลังแก้ = ไม่นับว่าซ้ำ
            if (currentEditingChapterId && doc.id === currentEditingChapterId) {
                // Pass (ตัวเอง)
            } else {
                isDup = true;
            }
        });
        return isDup;
    };
    // Event Listener: ตรวจสอบทันทีที่พิมพ์เสร็จ (Blur/Change)
    const chapNumInput = document.getElementById('chapter-number');
    if(chapNumInput) {
        chapNumInput.addEventListener('change', async function() {
            const novelId = document.getElementById('chapter-novel-select').value;
            const num = parseFloat(this.value);
            if(novelId && !isNaN(num)) {
                if(await checkDuplicateChapter(novelId, num)) {
                    Swal.fire('แจ้งเตือน', `ตอนที่ ${num} มีอยู่ในระบบแล้ว!`, 'warning');
                }
            }
        });
    }
    // ============================================================


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

            // [NEW] ตรวจสอบซ้ำก่อนบันทึกจริง (กันเหนียว)
            if(await checkDuplicateChapter(chapterData.novelId, chapterData.chapterNumber)) {
                Swal.fire('บันทึกไม่สำเร็จ', `เลขตอนซ้ำ! ตอนที่ ${chapterData.chapterNumber} มีอยู่แล้ว กรุณาตรวจสอบเลขตอนอีกครั้ง`, 'error');
                return;
            }

            const parentNovelRef = doc(db, 'novels', chapterData.novelId);
            try {
                if (currentEditingChapterId) {
                    const chapterDocRef = doc(db, 'chapters', currentEditingChapterId);
                    await updateDoc(chapterDocRef, chapterData);
                    await updateDoc(parentNovelRef, { lastChapterUpdatedAt: Timestamp.now() });
                    Swal.fire('อัปเดตสำเร็จ!', `ตอน "${chapterData.title}" ถูกอัปเดตแล้ว`, 'success');
                    window.setAdminChapterMode('add');
                } else {
                    chapterData.createdAt = Timestamp.now();
                    await addDoc(collection(db, 'chapters'), chapterData);
                    await updateDoc(parentNovelRef, { lastChapterUpdatedAt: Timestamp.now() });
                    Swal.fire('เพิ่มตอนใหม่สำเร็จ!', `ตอน "${chapterData.title}" ถูกบันทึกแล้ว`, 'success');
                    window.setAdminChapterMode('add');
                }
                loadNovels();
            } catch (error) {
                 Swal.fire('เกิดข้อผิดพลาด', error.message, 'error');
            }
        });
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
    const commentBtn = document.getElementById('reader-comment-post-btn');
    if(commentBtn) commentBtn.addEventListener('click', saveComment);

    const topupForm = document.getElementById('topup-form');
    if(topupForm) {
        topupForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            if (!currentUser) {
                Swal.fire('กรุณาเข้าสู่ระบบ', 'คุณต้องเข้าสู่ระบบก่อนแจ้งโอนเงิน', 'error');
                return;
            }
            const amount = document.getElementById('topup-amount').value;
            const time = document.getElementById('topup-time').value;
            if (!amount || !time) {
                Swal.fire('ข้อมูลไม่ครบ', 'กรุณาเลือกยอดเงินและระบุเวลาโอน', 'warning');
                return;
            }
            const points = pointPackages[amount] || 0;
            const requestData = {
                userId: currentUser.uid,
                username: currentUserData.username,
                amount: parseInt(amount),
                points: points,
                transferTime: time,
                status: 'pending',
                createdAt: Timestamp.now()
            };
            try {
                await addDoc(collection(db, "topup_requests"), requestData);
                Swal.fire({
                    title: 'แจ้งโอนสำเร็จ!',
                    text: 'แอดมินได้รับข้อมูลแล้ว จะทำการตรวจสอบและเติม Points ให้โดยเร็วที่สุดครับ',
                    icon: 'success'
                });
                topupForm.reset();
                document.getElementById('point-username').value = currentUserData.username;
                checkAdminNotifications();
            } catch (error) {
                console.error("Error saving topup request:", error);
                Swal.fire('เกิดข้อผิดพลาด', 'ไม่สามารถส่งข้อมูลได้', 'error');
            }
        });
    }

    setupDonateForm();
    setupContactForm(); // <--- [NEW] เรียกใช้ฟังก์ชัน Contact Form ตรงนี้

    const registerForm = document.getElementById('register-form');
    if(registerForm) {
        registerForm.addEventListener('submit', (e) => {
            e.preventDefault(); 
            const username = document.getElementById('reg-username').value.trim();
            const email = document.getElementById('reg-email').value.trim();
            const password = document.getElementById('reg-password').value;
            
            // --- UPDATED: ดึงค่าจากช่องยืนยันรหัสผ่าน ---
            const confirmPasswordInput = document.getElementById('reg-confirm-password');
            const confirmPassword = confirmPasswordInput ? confirmPasswordInput.value : '';

            // --- VALIDATION LOGIC ---
            if (username.length < 4) {
                 Swal.fire('ชื่อผู้ใช้สั้นเกินไป', 'กรุณาตั้งชื่อผู้ใช้งานอย่างน้อย 4 ตัวอักษร', 'warning');
                 return;
            }
            if (password !== confirmPassword) {
                 Swal.fire('รหัสผ่านไม่ตรงกัน', 'กรุณากรอกช่องรหัสผ่านและยืนยันรหัสผ่านให้ตรงกัน', 'error');
                 return;
            }
            if (password.length < 6) {
                 Swal.fire('รหัสผ่านสั้นเกินไป', 'รหัสผ่านต้องมีอย่างน้อย 6 ตัวอักษร', 'warning');
                 return;
            }
            // ------------------------

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
                        likedNovels: [],
                        unlockedChapters: [] 
                    });
                })
                .then(() => {
                    Swal.fire({ icon: 'success', title: 'ลงทะเบียนสำเร็จ!', text: `ยินดีต้อนรับ ${username}!`, timer: 2000, showConfirmButton: false });
                    window.showPage('page-home');
                })
                .catch((error) => {
                    console.error("Register Error:", error);
                    let errorMsg = "เกิดข้อผิดพลาด";
                    if (error.code === 'auth/email-already-in-use') errorMsg = 'อีเมลนี้ถูกใช้งานแล้ว';
                    else if (error.code === 'auth/weak-password') errorMsg = 'รหัสผ่านสั้นเกินไป (ต้อง 6 ตัวอักษรขึ้นไป)';
                    Swal.fire('ลงทะเบียนไม่สำเร็จ', errorMsg, 'error');
                });
        });
    }

    const loginForm = document.getElementById('login-form');
    if(loginForm) {
        loginForm.addEventListener('submit', (e) => {
            e.preventDefault();
            const email = document.getElementById('login-email').value;
            const password = document.getElementById('login-password').value;
            signInWithEmailAndPassword(auth, email, password)
                .then((userCredential) => {
                    window.showPage('page-home'); 
                    Swal.fire({ icon: 'success', title: 'เข้าสู่ระบบสำเร็จ!', toast: true, position: 'top-end', showConfirmButton: false, timer: 2000 });
                })
                .catch((error) => {
                    console.error("Login Error:", error);
                    Swal.fire('เข้าสู่ระบบไม่สำเร็จ', 'อีเมลหรือรหัสผ่านไม่ถูกต้อง', 'error');
                });
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
            const userDocRef = doc(db, 'users', user.uid);
            getDoc(userDocRef)
                .then(docSnap => {
                    if (docSnap.exists()) {
                        currentUserData = docSnap.data();
                        if(loggedOutView) loggedOutView.style.display = 'none';
                        if(loggedInView) loggedInView.style.display = 'flex';
                        if(userUsername) userUsername.textContent = currentUserData.username;
                        if(userPoints) userPoints.textContent = `${currentUserData.balancePoints} Points`;
                        if (pointPageUsername) {
                            pointPageUsername.value = currentUserData.username;
                            pointPageUsername.placeholder = "";
                        }
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
                    } else {
                        console.error("No user data found!");
                        window.logout(); 
                    }
                })
                .catch(error => {
                    console.error("Error getting user data:", error);
                    window.logout(); 
                });
        } else {
            currentUser = null;
            currentUserData = null;
            if(loggedOutView) loggedOutView.style.display = 'flex';
            if(loggedInView) loggedInView.style.display = 'none';
            if(userUsername) userUsername.textContent = '...';
            if(userPoints) userPoints.textContent = '... Points';
            if(adminNotifyBtn) adminNotifyBtn.style.display = 'none';
            if(adminTopupBtn) adminTopupBtn.style.display = 'none';
            if(adminSettingsBtn) adminSettingsBtn.style.display = 'none';
            if (pointPageUsername) {
                pointPageUsername.value = '';
                pointPageUsername.placeholder = "กรุณาเข้าสู่ระบบ";
            }
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
    // Reset selection styles
    document.querySelectorAll('.coffee-card').forEach(card => {
        card.classList.remove('selected');
    });
    // Highlight selected card
    const selectedCard = document.getElementById(`cup-${amount}`);
    if(selectedCard) {
        selectedCard.classList.add('selected');
    }

    // Show donate section
    const section = document.getElementById('donate-section');
    section.classList.remove('hidden');
    // Update form values
    document.getElementById('donate-amount-display').textContent = `฿${amount}`;
    document.getElementById('donate-amount-val').value = amount;
    // Auto-fill username if logged in
    if (currentUserData) {
        document.getElementById('donate-name').value = currentUserData.username;
    }
    
    // Smooth scroll to form
    section.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

window.setupDonateForm = function() {
    const form = document.getElementById('donate-form');
    if(form) {
        form.addEventListener('submit', async (e) => {
            e.preventDefault();
            const amount = document.getElementById('donate-amount-val').value;
            const name = document.getElementById('donate-name').value;
            const message = document.getElementById('donate-message').value;

            if(!amount || !name) {
                Swal.fire('ข้อมูลไม่ครบ', 'กรุณาระบุชื่อผู้เลี้ยงกาแฟด้วยนะคะ', 'warning');
                return;
            }

            try {
                // บันทึกลง Collection 'donations' (แยกจาก topup_requests เพราะไม่มีผลต่อ Point)
                await addDoc(collection(db, "donations"), {
                    amount: parseInt(amount),
                    donorName: name,
                    message: message,
                    userId: currentUser ? currentUser.uid : null, // เก็บ ID ไว้ (ถ้ามี) เผื่อในอนาคตอยากทำ Badge แฟนตัวยง
                    createdAt: Timestamp.now(),
                    isReadByAdmin: false
                });
                Swal.fire({
                    title: 'ขอบคุณมากค่ะ! ❤️',
                    text: 'ได้รับพลังเรียบร้อยแล้ว สัญญาว่าจะตั้งใจแปลงานดีๆ ให้อ่านกันต่อไปนะคะ',
                    imageUrl: 'https://i.pinimg.com/originals/9d/f7/53/9df753370d3f57e6d1325129db200f93.gif', // ใส่รูป GIF น่ารักๆ (ถ้าต้องการ) หรือลบบรรทัดนี้ออก
                    imageWidth: 200,
                    imageHeight: 200,
                    imageAlt: 'Thank You',
                    confirmButtonColor: '#f97316',
                    confirmButtonText: 'ด้วยความยินดี'
                });
                // Reset Form
                form.reset();
                document.getElementById('donate-section').classList.add('hidden');
                document.querySelectorAll('.coffee-card').forEach(c => c.classList.remove('selected'));
                
                // (Optional) อาจจะแจ้งเตือนแอดมินด้วยก็ได้ถ้าต้องการ แต่ตอนนี้แค่บันทึกเงียบๆ

            } catch (error) {
                console.error("Error saving donation:", error);
                Swal.fire('เกิดข้อผิดพลาด', 'ส่งข้อมูลไม่สำเร็จ กรุณาลองใหม่นะคะ', 'error');
            }
        });
    }
}

// ============================================================
//  6. CONTACT FORM FUNCTION (UPDATED: บันทึกลงฐานข้อมูลโดยตรง)
// ============================================================
window.setupContactForm = function() {
    const contactForm = document.getElementById('contactForm');
    if (contactForm) {
        contactForm.addEventListener('submit', async function(e) { // เพิ่ม async
            e.preventDefault();

            // 1. ดึงค่าจากฟอร์ม
            const name = document.getElementById('name').value;
            const email = document.getElementById('email').value;
            const topic = document.getElementById('topic').value;
            const message = document.getElementById('message').value;

            // ตรวจสอบความเรียบร้อย
            if (!name || !email || !message) {
                Swal.fire('ข้อมูลไม่ครบ', 'กรุณากรอกข้อมูลให้ครบถ้วนนะคะ', 'warning');
                return;
            }

            // 2. เตรียมข้อมูลที่จะบันทึก
            const contactData = {
                senderName: name,
                senderEmail: email,
                topic: topic,
                message: message,
                sentAt: Timestamp.now(), // ใช้วันเวลาปัจจุบัน
                isReadByAdmin: false,     // สถานะ: แอดมินยังไม่ได้อ่าน
                userId: currentUser ? currentUser.uid : null, // เก็บ ID ถ้าลูกค้าล็อกอินอยู่
                username: currentUserData ? currentUserData.username : 'Guest' // เก็บชื่อ User ถ้ามี
            };

            try {
                // 3. แสดง Loading ระหว่างส่ง
                Swal.fire({
                    title: 'กำลังส่งข้อความ...',
                    allowOutsideClick: false,
                    didOpen: () => {
                        Swal.showLoading();
                    }
                });

                // 4. บันทึกลง Collection ชื่อ "contact_messages" ใน Firebase
                await addDoc(collection(db, "contact_messages"), contactData);

                // 5. แจ้งเตือนสำเร็จ
                Swal.fire({
                    icon: 'success',
                    title: 'ส่งข้อความเรียบร้อย!',
                    text: 'แอดมินได้รับข้อความแล้ว จะรีบติดต่อกลับให้เร็วที่สุดค่ะ',
                    confirmButtonColor: '#6b21a8'
                });

                // Reset Form (ล้างค่าในช่อง)
                contactForm.reset();
                
                // (ถ้าเป็นแอดมิน) ให้เช็คแจ้งเตือนทันที
                checkAdminNotifications();

            } catch (error) {
                console.error("Error sending contact message:", error);
                Swal.fire('เกิดข้อผิดพลาด', 'ไม่สามารถส่งข้อความได้ในขณะนี้ กรุณาลองใหม่ภายหลัง', 'error');
            }
        });
    }
}

// ============================================================
//  7. ADMIN INBOX FUNCTIONS (ระบบอ่านจดหมาย)
// ============================================================

window.loadAdminInbox = async function() {
    const container = document.getElementById('admin-inbox-list');
    if (!db || !container) return;

    container.innerHTML = '<tr><td colspan="5" class="p-8 text-center text-gray-500">กำลังโหลดข้อความ...</td></tr>';

    try {
        // ดึงข้อมูลจาก Contact Messages
        const q = query(collection(db, "contact_messages")); // ดึงทั้งหมด
        const querySnapshot = await getDocs(q);
        
        let messages = [];
        querySnapshot.forEach((doc) => {
            messages.push({ id: doc.id, ...doc.data() });
        });

        // เรียงลำดับ: ใหม่ล่าสุดขึ้นก่อน (และเอาที่ยังไม่อ่านขึ้นบนสุด)
        messages.sort((a, b) => {
            if (a.isReadByAdmin === b.isReadByAdmin) {
                return b.sentAt - a.sentAt; // ถ้าสถานะเหมือนกัน ให้เรียงตามเวลา
            }
            return a.isReadByAdmin ? 1 : -1; // เอาที่ยังไม่อ่าน (false) ขึ้นก่อน
        });

        container.innerHTML = '';
        if (messages.length === 0) {
            container.innerHTML = '<tr><td colspan="5" class="p-8 text-center text-gray-400">ยังไม่มีข้อความส่งเข้ามา</td></tr>';
            return;
        }

        messages.forEach(msg => {
            const row = document.createElement('tr');
            // ถ้ายังไม่อ่าน ให้พื้นหลังเป็นสีขาว ถ้าอ่านแล้วเป็นสีเทาอ่อน
            row.className = msg.isReadByAdmin ? "bg-gray-50 text-gray-500" : "bg-white font-medium";
            
            const dateDisplay = msg.sentAt ? msg.sentAt.toDate().toLocaleString('th-TH') : '-';
            const statusBadge = msg.isReadByAdmin 
                ? '<span class="px-2 py-1 text-xs text-green-600 bg-green-100 rounded-full">อ่านแล้ว</span>' 
                : '<span class="px-2 py-1 text-xs text-red-600 bg-red-100 rounded-full animate-pulse">ใหม่</span>';

            row.innerHTML = `
                <td class="p-4 whitespace-nowrap text-xs text-gray-400">
                    ${dateDisplay}
                    <div class="mt-1">${statusBadge}</div>
                </td>
                <td class="p-4 align-top">
                    <div class="font-bold text-purple-700">${msg.senderName}</div>
                    <div class="text-xs text-gray-500">${msg.senderEmail}</div>
                </td>
                <td class="p-4 align-top">
                    <span class="bg-gray-100 text-gray-600 px-2 py-1 rounded text-xs border">${msg.topic}</span>
                </td>
                <td class="p-4 align-top max-w-xs">
                    <p class="line-clamp-3 hover:line-clamp-none transition-all cursor-pointer">${msg.message}</p>
                </td>
                <td class="p-4 text-center align-top space-y-2">
                    ${!msg.isReadByAdmin ? 
                        `<button onclick="window.markMessageAsRead('${msg.id}')" class="w-full text-xs bg-green-500 hover:bg-green-600 text-white px-2 py-1 rounded shadow">รับทราบ</button>` 
                        : ''}
                    <button onclick="window.deleteMessage('${msg.id}')" class="w-full text-xs bg-red-100 hover:bg-red-200 text-red-600 px-2 py-1 rounded">ลบ</button>
                </td>
            `;
            container.appendChild(row);
        });

    } catch (error) {
        console.error("Error loading inbox:", error);
        container.innerHTML = '<tr><td colspan="5" class="p-8 text-center text-red-500">โหลดข้อมูลไม่สำเร็จ</td></tr>';
    }
}

window.markMessageAsRead = async function(msgId) {
    try {
        await updateDoc(doc(db, "contact_messages", msgId), {
            isReadByAdmin: true
        });
        
        // [NEW] Instant UI Update: ลดตัวเลข Inbox ทันทีโดยไม่ต้องรอโหลดใหม่
        const badge = document.getElementById('admin-inbox-badge');
        if (badge && !badge.classList.contains('hidden')) {
             let count = parseInt(badge.textContent) || 0;
             count = Math.max(0, count - 1);
             if (count === 0) {
                 badge.classList.add('hidden');
                 badge.style.display = 'none';
             } else {
                 badge.textContent = count > 9 ? '9+' : count;
             }
        }

        // โหลดหน้าใหม่เพื่อให้สถานะเปลี่ยน (ในตาราง)
        window.loadAdminInbox();
        // window.checkAdminNotifications(); // ไม่จำเป็นต้องเรียกซ้ำเพราะเราลดตัวเลขเองแล้ว
    } catch (error) {
        console.error("Error marking read:", error);
    }
}

window.deleteMessage = async function(msgId) {
    Swal.fire({
        title: 'ลบข้อความ?',
        text: "ลบแล้วกู้คืนไม่ได้นะคะ",
        icon: 'warning',
        showCancelButton: true,
        confirmButtonColor: '#d33',
        confirmButtonText: 'ลบเลย'
    }).then(async (result) => {
        if (result.isConfirmed) {
            try {
                // เช็คก่อนลบว่าข้อความนี้อ่านหรือยัง ถ้ายังไม่อ่านต้องลด Badge ด้วย
                // แต่เพื่อความง่าย เราจะลด Badge เสมอถ้าข้อความหายไปและ Badge ยังโชว์อยู่
                // (Logic จริงซับซ้อนกว่านี้ แต่แค่นี้ก็เพียงพอสำหรับ Admin คนเดียว)
                
                await deleteDoc(doc(db, "contact_messages", msgId));
                
                // [NEW] Instant UI Update: ลดตัวเลข Inbox ทันที
                const badge = document.getElementById('admin-inbox-badge');
                if (badge && !badge.classList.contains('hidden')) {
                     // เราอาจจะไม่รู้ว่าข้อความที่ลบมัน 'อ่านแล้ว' หรือยัง 
                     // แต่การเรียก checkAdminNotifications ทีหลังจะช่วยแก้ให้ถูกเอง
                     // ดังนั้นตรงนี้เราปล่อยผ่าน หรือจะเรียก checkAdminNotifications() ก็ได้
                     window.checkAdminNotifications();
                }

                window.loadAdminInbox();
                Swal.fire('ลบแล้ว', 'ข้อความถูกลบออกจากระบบ', 'success');
            } catch (error) {
                Swal.fire('Error', 'ลบไม่สำเร็จ', 'error');
            }
        }
    });
}
