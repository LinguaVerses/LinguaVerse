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
//  ⚠️ นำค่า Config เดิมของคุณมาวางทับตรงนี้ (ตรวจสอบลูกน้ำ , ให้ครบทุกบรรทัดนะคะ) ⚠️
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
//  1. HELPER FUNCTIONS
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
        const querySnapshot = await getDocs(collection(db, "novels"));
        novelCache = []; 
        let novelCount = { KR: 0, CN: 0, EN: 0, JP: 0 };
        
        // --- 🕒 ใช้เวลา 3 วันตามปกติ ---
        const timeAgoLimit = Date.now() - (3 * 24 * 60 * 60 * 1000); 
        
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
                card.setAttribute('onclick', `window.showNovelDetail('${novelId}', '${novel.status}')`); 
                let licensedBadge = '';
                if (novel.isLicensed) {
                    licensedBadge = '<span class="absolute top-2 left-2 bg-red-600 text-white text-xs font-bold px-2 py-1 rounded">ลิขสิทธิ์</span>';
                }
                let newBadge = '';
                let isNew = false;
                
                if (novel.lastChapterUpdatedAt && novel.lastChapterUpdatedAt.toDate().getTime() > timeAgoLimit) {
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
                
                if (isNew && homeUpdatesContainer && homeUpdatesContainer.childElementCount < 5) {
                     const homeCard = document.createElement('div');
                     homeCard.className = "flex items-center space-x-3 p-2 hover:bg-gray-50 rounded-lg cursor-pointer";
                     homeCard.onclick = () => window.showNovelDetail(novelId, novel.status);
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
            if (novelCount[lang] === 0 && containers[lang]) {
                containers[lang].innerHTML = '<p class="text-gray-500 col-span-full">ยังไม่มีนิยายในหมวดนี้...</p>';
            }
        });
        if (homeUpdatesContainer && homeUpdatesContainer.childElementCount === 0) {
            homeUpdatesContainer.innerHTML = '<p class="text-gray-500">ยังไม่มีนิยายที่อัปเดต...</p>';
        }
    } catch (error) {
        console.error("Error loading novels: ", error);
        ['KR', 'CN', 'EN', 'JP'].forEach(lang => {
            if(containers[lang]) containers[lang].innerHTML = '<p class="text-red-500 col-span-full">ไม่สามารถโหลดนิยายได้</p>';
            const loadingText = document.getElementById(`novel-loading-${lang.toLowerCase()}`);
            if (loadingText) loadingText.style.display = 'none';
        });
    }
}

// --- New Function: Filter Novels ---
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

    const timeAgoLimit = Date.now() - (3 * 24 * 60 * 60 * 1000); // 3 วัน
    let hasResults = { 'KR': false, 'CN': false, 'EN': false, 'JP': false };

    novelCache.forEach(novel => {
        // Filter Logic
        const matchText = novel.title_en.toLowerCase().includes(searchText) || 
                          (novel.title_th && novel.title_th.includes(searchText));
        const matchStatus = statusFilter === "" || novel.status === statusFilter;
        const matchCategory = categoryFilter === "" || (novel.categories && novel.categories.includes(categoryFilter));

        if (matchText && matchStatus && matchCategory) {
            const lang = novel.language.toUpperCase();
            if (containers[lang]) {
                hasResults[lang] = true;

                // Render Card
                const card = document.createElement('div');
                card.className = "bg-white rounded-lg shadow-md overflow-hidden transform transition-transform hover:scale-105 cursor-pointer";
                card.setAttribute('onclick', `window.showNovelDetail('${novel.id}', '${novel.status}')`); 
                
                let licensedBadge = '';
                if (novel.isLicensed) {
                    licensedBadge = '<span class="absolute top-2 left-2 bg-red-600 text-white text-xs font-bold px-2 py-1 rounded">ลิขสิทธิ์</span>';
                }
                let newBadge = '';
                if (novel.lastChapterUpdatedAt && novel.lastChapterUpdatedAt.toDate().getTime() > timeAgoLimit) {
                    newBadge = '<span class="absolute top-2 right-2 bg-purple-600 text-white text-xs font-bold px-2 py-1 rounded animate-pulse">NEW</span>';
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
            }
        }
    });

    // Show "Not Found" message if empty
    for(let key in containers) {
        if(!hasResults[key] && containers[key]) {
            containers[key].innerHTML = '<p class="text-gray-400 col-span-full">ไม่พบนิยายที่ค้นหา...</p>';
        }
    }
}

async function checkAdminNotifications() {
    if (!db || !currentUserData || currentUserData.role !== 'admin') {
        return;
    }
    const commentBadge = document.getElementById('admin-notify-badge');
    const topupBadge = document.getElementById('admin-topup-badge');
    
    try {
        // Check Comments
        const qComment = query(collection(db, "comments"), where("isReadByAdmin", "==", false));
        const snapComment = await getDocs(qComment);
        const commentCount = snapComment.size;
        if (commentCount > 0) {
            commentBadge.textContent = commentCount > 9 ? '9+' : commentCount;
            commentBadge.classList.remove('hidden');
        } else {
            commentBadge.classList.add('hidden');
        }

        // Check Pending Topups
        const qTopup = query(collection(db, "topup_requests"), where("status", "==", "pending"));
        const snapTopup = await getDocs(qTopup);
        const topupCount = snapTopup.size;
        if (topupCount > 0) {
            topupBadge.textContent = topupCount > 9 ? '9+' : topupCount;
            topupBadge.classList.remove('hidden');
        } else {
            topupBadge.classList.add('hidden');
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
            loadAuthorOtherWorks(novel.author, novelId);
            checkUserLikeStatus(novelId, novel.totalLikes || 0);
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

// --- Updated: Load Novel Chapters with Schedule Logic ---
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
        
        // --- Schedule Logic ---
        const now = new Date();
        const isAdmin = currentUserData && currentUserData.role === 'admin';
        
        // Filter chapters: Hide if (scheduledTime > now) AND (user is NOT admin)
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
            
            // Visual indicator for Admin if scheduled in future
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
    if (currentIndex > 0) {
        const prevChapter = currentNovelChapters[currentIndex - 1];
        prevButton = `<button onclick="window.showReaderPage('${prevChapter.id}', ${prevChapter.pointCost})" class="px-4 py-2 bg-purple-600 text-white rounded-lg shadow-md hover:bg-purple-700 flex items-center"><i data-lucide="arrow-left" class="w-4 h-4 mr-1"></i> ตอนก่อนหน้า</button>`;
    }

    if (currentIndex < currentNovelChapters.length - 1) {
        const nextChapter = currentNovelChapters[currentIndex + 1];
        nextButton = `<button onclick="window.showReaderPage('${nextChapter.id}', ${nextChapter.pointCost})" class="px-4 py-2 bg-purple-600 text-white rounded-lg shadow-md hover:bg-purple-700 flex items-center">ตอนถัดไป <i data-lucide="arrow-right" class="w-4 h-4 ml-1"></i></button>`;
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
                </div>
            `;
            container.appendChild(commentEl);
        });
    } catch (error) {
        console.error("Error loading comments:", error);
        container.innerHTML = '<p class="text-red-500 p-3">ไม่สามารถโหลดคอมเมนต์ได้</p>';
    }
}

// ============================================================
//  2. WINDOW FUNCTIONS
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

    // --- แก้ไข: ตรวจสอบสิทธิ์ Admin หรือเคยซื้อแล้ว ---
    if (currentUserData.role === 'admin') {
        loadChapterContent(chapterId); // Admin อ่านฟรีทันที
        return;
    }
    
    if (currentUserData.unlockedChapters && currentUserData.unlockedChapters.includes(chapterId)) {
        loadChapterContent(chapterId); // เคยซื้อแล้ว อ่านได้เลย
        return;
    }

    if (pointCost === 0) {
        loadChapterContent(chapterId); // ตอนฟรี
    } else {
        window.showPointAlert(chapterId, pointCost); // ต้องจ่ายเงิน
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
//  3. WINDOW.ONLOAD
// ============================================================

window.onload = function() {
    try {
        if (window.lucide) window.lucide.createIcons();
    } catch (error) {
        console.error("Lucide error:", error);
    }
    
    try {
        // เช็คว่ามีการใส่ Config หรือยัง
        if (firebaseConfig.apiKey === "นำรหัสของคุณมาใส่ตรงนี้" || firebaseConfig.apiKey.includes("xxx")) {
            Swal.fire('Config Error', 'กรุณาใส่ Firebase Config ในไฟล์ app.js บรรทัดบนสุด', 'error');
            throw new Error("Missing Firebase Config");
        }
        
        app = initializeApp(firebaseConfig);
        auth = getAuth(app);
        db = getFirestore(app);
        console.log("Firebase initialized successfully!");
    } catch (error) {
        console.error("Firebase initialization failed:", error);
        // ถ้า Error ตรงนี้ สคริปต์จะหยุดทำงาน ทำให้ปุ่มต่างๆ ไม่ทำงานด้วย
        return; 
    }
    
    // --- TOGGLE PASSWORD VISIBILITY (แก้ไขให้ทำงานชัวร์ๆ) ---
    function setupPasswordToggle(btnId, inputId, iconId) {
        const btn = document.getElementById(btnId);
        const input = document.getElementById(inputId);
        const icon = document.getElementById(iconId);
        
        if (btn && input && icon) {
            btn.addEventListener('click', (e) => {
                e.preventDefault(); // ป้องกันการกดปุ่มแล้ว Form Submit
                const type = input.getAttribute('type') === 'password' ? 'text' : 'password';
                input.setAttribute('type', type);
                
                // เปลี่ยนไอคอน
                if (type === 'text') {
                    icon.setAttribute('data-lucide', 'eye');
                } else {
                    icon.setAttribute('data-lucide', 'eye-off');
                }
                if (window.lucide) window.lucide.createIcons();
            });
        }
    }

    // เรียกใช้ฟังก์ชันสำหรับหน้า Login และ Register
    setupPasswordToggle('reg-toggle-password', 'reg-password', 'reg-toggle-icon');
    setupPasswordToggle('login-toggle-password', 'login-password', 'login-toggle-icon');
    
    // Event Listeners
    const loadNovelEditBtn = document.getElementById('load-novel-to-edit-btn');
    if(loadNovelEditBtn) loadNovelEditBtn.addEventListener('click', loadNovelForEditing);

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
    
    // --- Topup Form Submission (New) ---
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

            // คำนวณ Points
            const points = pointPackages[amount] || 0;

            const requestData = {
                userId: currentUser.uid,
                username: currentUserData.username,
                amount: parseInt(amount),
                points: points,
                transferTime: time, // เก็บเป็น string จาก input ไปเลย ง่ายต่อการอ่าน
                status: 'pending', // สถานะรอตรวจสอบ
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
                document.getElementById('point-username').value = currentUserData.username; // ใส่ชื่อกลับเข้าไป
                checkAdminNotifications(); // อัปเดตแจ้งเตือนแอดมิน (เผื่อแอดมินลองระบบเอง)
            } catch (error) {
                console.error("Error saving topup request:", error);
                Swal.fire('เกิดข้อผิดพลาด', 'ไม่สามารถส่งข้อมูลได้', 'error');
            }
        });
    }

    const registerForm = document.getElementById('register-form');
    if(registerForm) {
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
                        likedNovels: [],
                        unlockedChapters: [] // เริ่มต้นด้วยอาเรย์ว่าง
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
        const adminTopupBtn = document.getElementById('admin-topup-btn'); // ปุ่มใหม่
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
                        
                        // Admin Controls
                        if (currentUserData.role === 'admin') {
                            if(adminNotifyBtn) adminNotifyBtn.style.display = 'block';
                            if(adminTopupBtn) adminTopupBtn.style.display = 'block'; // ปุ่มใหม่
                            if(adminSettingsBtn) adminSettingsBtn.style.display = 'block';
                            checkAdminNotifications(); 
                        } else {
                            if(adminNotifyBtn) adminNotifyBtn.style.display = 'none';
                            if(adminTopupBtn) adminTopupBtn.style.display = 'none'; // ปุ่มใหม่
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
