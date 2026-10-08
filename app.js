const namesInput = document.querySelector('#names');
const studentCount = document.querySelector('#student-count');
const groupCount = document.querySelector('#group-count');
const excelFile = document.querySelector('#excel-file');
const fileStatus = document.querySelector('#file-status');
const studentData = document.querySelector('#student-data');
 
/* ------------------------------------------------------------------
   أدوات مساعدة للنصوص العربية
------------------------------------------------------------------ */
 
// تحويل الأرقام العربية/الهندية إلى أرقام لاتينية
function toLatinDigits(value) {
    return String(value ?? '')
        .replace(/[\u0660-\u0669]/g, (d) => String(d.charCodeAt(0) - 0x0660))
        .replace(/[\u06F0-\u06F9]/g, (d) => String(d.charCodeAt(0) - 0x06F0));
}
 
// تطبيع عنوان العمود: حذف التشكيل والتطويل وتوحيد الهمزات والتاء المربوطة
function normalizeHeader(value) {
    return toLatinDigits(value)
        .replace(/[\u064B-\u0652\u0670\u0640]/g, '')
        .replace(/[\u0623\u0625\u0622\u0671]/g, '\u0627')
        .replace(/\u0649/g, '\u064A')
        .replace(/\u0626/g, '\u064A')
        .replace(/\u0624/g, '\u0648')
        .replace(/\u0629/g, '\u0647')
        .toLowerCase()
        .replace(/[^0-9a-z\u0621-\u064A]+/g, '');
}
 
function cleanCell(value) {
    return String(value ?? '').replace(/\s+/g, ' ').trim();
}

// فك ترميز CSV: UTF-8 أولًا، وإن فشل فـ windows-1256 (ترميز Excel العربي القديم)
function decodeCsvBuffer(buffer) {
    try {
        return new TextDecoder('utf-8', { fatal: true }).decode(buffer).replace(/^\uFEFF/, '');
    } catch {
        return new TextDecoder('windows-1256').decode(buffer);
    }
}
 
function columnLetter(index) {
    let letter = '';
    let current = index;
    do {
        letter = String.fromCharCode(65 + (current % 26)) + letter;
        current = Math.floor(current / 26) - 1;
    } while (current >= 0);
    return letter;
}
 
/* ------------------------------------------------------------------
   قواعد التعرف على الأعمدة الثلاثة
   block  = كلمات تُلغي احتمال أن يكون العمود لهذا الحقل
   levels = أنماط مرتبة من الأقوى إلى الأضعف مع درجة ثقة
------------------------------------------------------------------ */
const FIELD_RULES = {
    id: {
        block: /(تسلسل|مسلسل|serial|الشعبه|الفئه|المجموعه|الصف|العمر|الهاتف|الجوال|موبايل|phone|mobile|درجه|علامه|mark|grade|السنه|تاريخ|date)/,
        levels: [
            [/(الرقمالجامعي|رقمجامعي|جامعي|رقمالقيد|رقمالتسجيل|رقمالطالب|رقمالاكاديمي|اكاديمي|الرقمالوطني|الهويه|هويه|studentid|studentno|studentnumber|universityid|universitynumber|registrationnumber|regno|matricule)/, 100],
            [/^(id|no|num|number|code|رقم|الرقم|كود|القيد)$/, 55],
            [/(رقم|number|id|code)/, 25],
        ],
    },
    name: {
        block: /(الاب|الوالد|father|parent|العائله|الكنيه|الشهره|اللقب|الام|mother|الجد)/,
        levels: [
            [/(اسمالطالب|اسمالطالبه|اسمالمتدرب|الاسمالكامل|الاسمالثلاثي|الاسمالرباعي|الاسمالثنائي|studentname|fullname|pupilname)/, 100],
            [/^(الاسم|اسم|الطالب|الطالبه|name|student)$/, 70],
            [/(اسم|name|طالب|student)/, 20],
        ],
    },
    father: {
        block: /(الام(?!ر)|mother|الجد)/,
        levels: [
            [/(اسمالاب|اسمالوالد|اسمالابالكامل|اسمالوالدالكامل|اسموليالامر|fathername|parentname|guardianname)/, 100],
            [/^(الاب|اب|الوالد|father|parent|وليالامر|ولي)$/, 70],
            [/(الاب|الوالد|father|parent)/, 30],
        ],
    },
};
 
// إسناد أفضل عمود لكل حقل (الأعلى ثقةً يحصل على العمود أولًا)
function detectColumnsFromHeader(headerRow) {
    const candidates = [];
 
    headerRow.forEach((cell, col) => {
        const text = normalizeHeader(cell);
        if (!text) return;
 
        Object.entries(FIELD_RULES).forEach(([field, rule]) => {
            if (rule.block.test(text)) return;
            const matched = rule.levels.find(([pattern]) => pattern.test(text));
            if (matched) candidates.push({ field, col, score: matched[1] });
        });
    });
 
    candidates.sort((first, second) => second.score - first.score || first.col - second.col);
 
    const mapping = {};
    const usedColumns = new Set();
    let total = 0;
 
    candidates.forEach(({ field, col, score }) => {
        if (mapping[field] !== undefined || usedColumns.has(col)) return;
        mapping[field] = col;
        usedColumns.add(col);
        total += score;
    });
 
    return { mapping, total };
}
 
// البحث عن صف العنوان في أول 15 صفًا (لتجاوز العناوين والشعارات في أعلى الملف)
function findHeaderRow(rows) {
    let best = null;
    const limit = Math.min(rows.length, 15);
 
    for (let index = 0; index < limit; index++) {
        const { mapping, total } = detectColumnsFromHeader(rows[index] || []);
        const usable = mapping.name !== undefined || (mapping.id !== undefined && mapping.father !== undefined);
        if (!usable || total < 55) continue;
        if (!best || total > best.total) best = { rowIndex: index, mapping, total };
    }
 
    return best;
}
 
// خطة بديلة: التعرف على الأعمدة من محتواها عندما لا يوجد صف عنوان
function detectColumnsFromContent(rows) {
    const width = rows.reduce((max, row) => Math.max(max, row.length), 0);
    const stats = [];
 
    for (let col = 0; col < width; col++) {
        const values = rows.map((row) => cleanCell(row[col])).filter(Boolean);
        if (values.length === 0) continue;
 
        const numeric = values.filter((value) => /^[0-9][0-9\-/]*$/.test(toLatinDigits(value))).length;
        const textual = values.filter((value) => /[\u0621-\u064A]{2,}/.test(value) || /[a-zA-Z]{2,}/.test(value)).length;
        const unique = new Set(values.map((value) => toLatinDigits(value))).size;
        const sequential = values.length > 2 && values.every((value, i) => Number(toLatinDigits(value)) === i + 1);
        const words = values.reduce((sum, value) => sum + value.split(' ').length, 0) / values.length;
        const maxLength = values.reduce((max, value) => Math.max(max, value.length), 0);
 
        stats.push({
            col,
            filled: values.length,
            numericRatio: numeric / values.length,
            textRatio: textual / values.length,
            uniqueRatio: unique / values.length,
            sequential,
            words,
            maxLength,
        });
    }
 
    const mapping = {};
 
    // الرقم الجامعي: عمود رقمي، قيمه غير متكررة، وليس ترقيمًا تسلسليًا 1,2,3...
    const idCandidate = stats
        .filter((stat) => !stat.sequential && stat.numericRatio > 0.7 && stat.uniqueRatio > 0.9 && stat.maxLength >= 3)
        .sort((first, second) => second.uniqueRatio - first.uniqueRatio || second.maxLength - first.maxLength)[0];
    if (idCandidate) mapping.id = idCandidate.col;
 
    // الاسم واسم الأب: أكثر عمودين نصيين امتلاءً
    const textCandidates = stats
        .filter((stat) => stat.col !== mapping.id && stat.textRatio > 0.6)
        .sort((first, second) => second.filled - first.filled || second.words - first.words)
        .slice(0, 2)
        .sort((first, second) => first.col - second.col);
 
    if (textCandidates.length === 1) {
        mapping.name = textCandidates[0].col;
    } else if (textCandidates.length === 2) {
        const [left, right] = textCandidates;
        // الاسم الكامل عادةً أطول من اسم الأب
        if (right.words - left.words > 0.4) {
            mapping.name = right.col;
            mapping.father = left.col;
        } else {
            mapping.name = left.col;
            mapping.father = right.col;
        }
    }
 
    return mapping;
}
 
/* ------------------------------------------------------------------
   قراءة الملف
------------------------------------------------------------------ */
 
function countNames() {
    const names = namesInput.value
        .split(/\n+/)
        .map((name) => name.trim())
        .filter(Boolean);
    studentCount.textContent = names.length;
}
 
function setStatus(message, state) {
    fileStatus.textContent = message;
    fileStatus.className = state ? `file-status is-${state}` : 'file-status';
}
 
function buildStudents(rows, mapping) {
    const nameCol = mapping.name;
    const idCol = mapping.id;
    const fatherCol = mapping.father;
 
    const students = rows
        .map((row) => ({
            name: nameCol === undefined ? '' : cleanCell(row[nameCol]),
            id: idCol === undefined ? '' : toLatinDigits(cleanCell(row[idCol])),
            fatherName: fatherCol === undefined ? '' : cleanCell(row[fatherCol]),
        }))
        .filter((student) => student.name !== '' && !/^[0-9]+$/.test(student.name));
 
    // لا نحذف المتشابهين إلا إذا كان عمود الرقم الجامعي موثوقًا فعلًا
    const ids = students.map((student) => student.id).filter(Boolean);
    const idIsReliable = ids.length >= students.length * 0.8 && new Set(ids).size >= ids.length * 0.8;
 
    if (!idIsReliable) return students;
 
    const seen = new Map();
    students.forEach((student, index) => {
        const key = student.id !== '' ? `id:${student.id}` : `row:${index}`;
        if (!seen.has(key)) seen.set(key, student);
    });
    return [...seen.values()];
}
 
excelFile.addEventListener('change', async () => {
    const file = excelFile.files[0];
    if (!file) return;
 
    setStatus('جارٍ قراءة الملف...', 'loading');
 
    try {
        const buffer = await file.arrayBuffer();
        const isCsv = /\.csv$/i.test(file.name);
        const workbook = isCsv
            ? XLSX.read(decodeCsvBuffer(buffer), { type: 'string' })
            : XLSX.read(buffer, { type: 'array', cellDates: false });
        const firstSheet = workbook.Sheets[workbook.SheetNames[0]];
        const allRows = XLSX.utils
            .sheet_to_json(firstSheet, { header: 1, defval: '', raw: false, blankrows: false })
            .filter((row) => row.some((cell) => cleanCell(cell) !== ''));
 
        if (allRows.length === 0) {
            throw new Error('الملف فارغ أو لا يحتوي على بيانات.');
        }
 
        const header = findHeaderRow(allRows);
        let mapping;
        let dataRows;
        let source;
 
        if (header) {
            mapping = header.mapping;
            dataRows = allRows.slice(header.rowIndex + 1);
            source = 'header';
            // إذا لم يُعرَف عمود الاسم من العناوين، نستنتجه من المحتوى
            if (mapping.name === undefined) {
                const fromContent = detectColumnsFromContent(dataRows);
                if (fromContent.name !== undefined && fromContent.name !== mapping.id) {
                    mapping.name = fromContent.name;
                }
            }
        } else {
            dataRows = allRows;
            mapping = detectColumnsFromContent(dataRows);
            source = 'content';
        }
 
        if (mapping.name === undefined) {
            throw new Error('لم يتم التعرف على عمود اسم الطالب. أضف عنوانًا مثل «اسم الطالب».');
        }
 
        const students = buildStudents(dataRows, mapping);
        if (students.length === 0) {
            throw new Error('لم يتم العثور على أي أسماء طلاب في الملف.');
        }
 
        namesInput.value = students.map((student) => student.name).join('\n');
        studentData.value = JSON.stringify(students);
        countNames();
 
        const detected = [
            `الاسم: ${columnLetter(mapping.name)}`,
            mapping.id !== undefined ? `الرقم الجامعي: ${columnLetter(mapping.id)}` : 'الرقم الجامعي: غير موجود',
            mapping.father !== undefined ? `اسم الأب: ${columnLetter(mapping.father)}` : 'اسم الأب: غير موجود',
        ].join(' · ');
 
        setStatus(
            `تم تحميل ${students.length} طالبًا من ${file.name} — ${detected}` +
            (source === 'content' ? ' (تم الاستنتاج من المحتوى لعدم وجود عناوين)' : ''),
            'success',
        );
    } catch (error) {
        setStatus(error.message || 'تعذر قراءة الملف.', 'error');
        studentData.value = '';
        countNames();
    } finally {
        // السماح باختيار الملف نفسه مرة أخرى
        excelFile.value = '';
    }
});
 
namesInput.addEventListener('input', () => {
    studentData.value = '';
    countNames();
});
 
document.querySelectorAll('.stepper').forEach((button) => {
    button.addEventListener('click', () => {
        const change = button.dataset.action === 'increase' ? 1 : -1;
        groupCount.value = Math.max(1, Number(groupCount.value || 1) + change);
    });
});
 
countNames();
 
/* ------------------------------------------------------------------
   تصدير النتيجة إلى Excel
------------------------------------------------------------------ */
const exportButton = document.querySelector('#export-excel');
 
if (exportButton) {
    exportButton.addEventListener('click', () => {
        const rows = [['الرقم الجامعي', 'الاسم', 'اسم الأب', 'الفئة']];
 
        document.querySelectorAll('.group-card').forEach((card) => {
            const groupName = card.querySelector('h3')?.textContent.trim() || '';
            card.querySelectorAll('li').forEach((studentRow) => {
                rows.push([
                    studentRow.querySelector('.student-id')?.textContent.trim() || '',
                    studentRow.querySelector('.student-name')?.textContent.trim() || '',
                    studentRow.querySelector('.student-father-name')?.textContent.trim() || '',
                    groupName,
                ]);
            });
        });
 
        if (rows.length === 1) return;
 
        const worksheet = XLSX.utils.aoa_to_sheet(rows);
        worksheet['!cols'] = [{ wch: 20 }, { wch: 32 }, { wch: 28 }, { wch: 18 }];
        worksheet['!autofilter'] = { ref: `A1:D${rows.length}` };
        const workbook = XLSX.utils.book_new();
        workbook.Workbook = { Views: [{ RTL: true }] };
        XLSX.utils.book_append_sheet(workbook, worksheet, 'توزيع الطلاب');
        XLSX.writeFile(workbook, 'توزيع-الطلاب.xlsx');
    });
}