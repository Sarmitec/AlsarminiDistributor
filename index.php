<?php
$namesText = '';
$studentData = '';
$groupCount = 3;
$groups = [];
$error = '';

function parseNames(string $text): array
{
    $lines = preg_split('/[\r\n]+/u', $text) ?: [];
    $names = [];

    foreach ($lines as $line) {
        $name = trim(preg_replace('/\s+/u', ' ', $line));
        if ($name !== '') {
            $names[] = $name;
        }
    }

    // لا نستخدم array_unique هنا: قد يتشابه اسمان لطالبين مختلفين
    return $names;
}

function parseStudents(string $text, string $studentData): array
{
    $decoded = json_decode($studentData, true);
    if (is_array($decoded)) {
        $rows = [];
        foreach ($decoded as $student) {
            if (is_array($student) && trim((string) ($student['name'] ?? '')) !== '') {
                $rows[] = [
                    'name' => trim((string) $student['name']),
                    'id' => trim((string) ($student['id'] ?? '')),
                    'fatherName' => trim((string) ($student['fatherName'] ?? '')),
                ];
            }
        }

        // نحذف التكرار بالرقم الجامعي فقط إذا كان العمود مميزًا فعلًا،
        // وإلا فقد يكون عمودًا آخر (شعبة/سنة) ونفقد معظم الطلاب.
        $ids = array_values(array_filter(array_column($rows, 'id'), static fn(string $id): bool => $id !== ''));
        $idIsReliable = $rows !== []
            && count($ids) >= count($rows) * 0.8
            && count(array_unique($ids)) >= count($ids) * 0.8;

        $students = [];
        $seenKeys = [];
        foreach ($rows as $rowIndex => $row) {
            $studentKey = $idIsReliable && $row['id'] !== '' ? 'id:' . $row['id'] : 'row:' . $rowIndex;
            if (isset($seenKeys[$studentKey])) {
                continue;
            }
            $seenKeys[$studentKey] = true;
            $students[] = $row;
        }
        if ($students !== []) {
            return $students;
        }
    }

    return array_map(static fn(string $name): array => ['name' => $name, 'id' => '', 'fatherName' => ''], parseNames($text));
}

function sortStudents(array $students): array
{
    if (class_exists('Collator')) {
        $collator = new Collator('ar');
        $collator->setStrength(Collator::PRIMARY);
        usort($students, static fn(array $first, array $second): int => $collator->compare($first['name'], $second['name'])
            ?: $collator->compare($first['fatherName'], $second['fatherName']));
    } else {
        usort($students, static fn(array $first, array $second): int => strcmp(mb_strtolower($first['name'], 'UTF-8'), mb_strtolower($second['name'], 'UTF-8'))
            ?: strcmp($first['fatherName'], $second['fatherName']));
    }

    return $students;
}

function distributeStudents(array $students, int $groupCount): array
{
    $total = count($students);
    $baseSize = intdiv($total, $groupCount);
    $extra = $total % $groupCount;
    $groups = [];
    $offset = 0;

    for ($index = 0; $index < $groupCount; $index++) {
        $size = $baseSize + ($index < $extra ? 1 : 0);
        $groups[] = array_slice($students, $offset, $size);
        $offset += $size;
    }

    return $groups;
}

if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    $namesText = (string) ($_POST['names'] ?? '');
    $studentData = (string) ($_POST['student_data'] ?? '');
    $groupCount = filter_input(INPUT_POST, 'group_count', FILTER_VALIDATE_INT) ?: 0;
    $students = sortStudents(parseStudents($namesText, $studentData));

    if (count($students) === 0) {
        $error = 'يرجى إدخال اسم طالب واحد على الأقل.';
    } elseif ($groupCount < 1) {
        $error = 'يرجى إدخال عدد صحيح للفئات يبدأ من 1.';
    } elseif ($groupCount > count($students)) {
        $error = 'عدد الفئات لا يمكن أن يتجاوز عدد الطلاب.';
    } else {
        $groups = distributeStudents($students, $groupCount);
    }
}

$totalStudents = array_sum(array_map('count', $groups));
?>
<!doctype html>
<html lang="ar" dir="rtl">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Alsarmini Distributor</title>
    <link rel="preconnect" href="https://fonts.googleapis.com">
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
    <link href="https://fonts.googleapis.com/css2?family=Cairo:wght@400;600;700;800&family=Space+Grotesk:wght@500;600;700&display=swap" rel="stylesheet">
    <link rel="stylesheet" href="style.css">
</head>
<body>
    <main class="page-shell">
        <section class="intro">
            <div class="brand-mark">01</div>
            <div>
                <p class="eyebrow">أداة تنظيم صفية</p>
                <h1>Alsarmini Distributor</h1>
                <p class="intro-copy">أدخل أسماء الطلاب وعدد الفئات، وسنرتبهم أبجديًا ونوزعهم بالتساوي</p>
            </div>
        </section>

        <form class="workspace" method="post" action="" id="distribution-form">
            <section class="input-panel">
                <div class="section-heading">
                    <span class="step">01</span>
                    <div>
                        <h2>قائمة الطلاب</h2>
                        <p>ارفع ملف Excel أو اكتب اسمًا في كل سطر.</p>
                    </div>
                </div>
                <label class="file-upload" for="excel-file">
                    <span class="upload-icon">↑</span>
                    <span class="upload-copy"><strong>اختيار ملف Excel</strong><small>يدعم XLSX و XLS و CSV</small></span>
                    <input type="file" id="excel-file" accept=".xlsx,.xls,.csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel,text/csv">
                </label>
                <div class="file-status" id="file-status" role="status"></div>
                <textarea name="names" id="names" placeholder="مثال:&#10;أحمد علي&#10;سارة محمد&#10;خالد حسن&#10;..." spellcheck="false"><?= htmlspecialchars($namesText, ENT_QUOTES, 'UTF-8') ?></textarea>
                <input type="hidden" name="student_data" id="student-data" value="<?= htmlspecialchars($studentData, ENT_QUOTES, 'UTF-8') ?>">
                <div class="field-note"><span id="student-count">0</span> أسماء مدخلة</div>
            </section>

            <section class="settings-panel">
                <div class="section-heading">
                    <span class="step">02</span>
                    <div>
                        <h2>عدد الفئات</h2>
                        <p>سيتم توزيع الطلاب بالتتابع بعد الترتيب.</p>
                    </div>
                </div>
                <div class="number-control">
                    <button type="button" class="stepper" data-action="decrease" aria-label="تقليل عدد الفئات">−</button>
                    <input type="number" name="group_count" id="group-count" min="1" value="<?= htmlspecialchars((string) $groupCount, ENT_QUOTES, 'UTF-8') ?>" aria-label="عدد الفئات">
                    <button type="button" class="stepper" data-action="increase" aria-label="زيادة عدد الفئات">+</button>
                </div>
                <button class="submit-button" type="submit">
                    <span>توزيع الطلاب</span>
                    <span class="button-arrow">←</span>
                </button>
                <p class="distribution-hint">الفئات المتوازنة قد تختلف بفارق طالب واحد فقط.</p>
            </section>
        </form>

        <?php if ($error !== ''): ?>
            <div class="alert" role="alert"><?= htmlspecialchars($error, ENT_QUOTES, 'UTF-8') ?></div>
        <?php endif; ?>

        <?php if ($groups !== []): ?>
            <section class="results" aria-live="polite">
                <div class="results-header">
                    <div>
                        <p class="eyebrow">النتيجة</p>
                        <h2>تم توزيع <?= $totalStudents ?> طالبًا على <?= count($groups) ?> فئات</h2>
                    </div>
                    <div class="results-actions">
                        <div class="result-badge">مرتب أبجديًا</div>
                        <button type="button" class="export-button" id="export-excel"><span>↓</span> تنزيل Excel</button>
                    </div>
                </div>
                <div class="groups-grid">
                    <?php foreach ($groups as $index => $group): ?>
                        <article class="group-card">
                            <div class="group-card-header">
                                <div class="group-title"><span><?= str_pad((string) ($index + 1), 2, '0', STR_PAD_LEFT) ?></span><h3>الفئة <?= $index + 1 ?></h3></div>
                                <strong><?= count($group) ?></strong>
                            </div>
                            <ol>
                                <?php foreach ($group as $student): ?>
                                    <li>
                                        <span class="student-name"><?= htmlspecialchars($student['name'], ENT_QUOTES, 'UTF-8') ?></span>
                                        <?php if ($student['fatherName'] !== ''): ?><span class="student-father-name"><?= htmlspecialchars($student['fatherName'], ENT_QUOTES, 'UTF-8') ?></span><?php endif; ?>
                                        <?php if ($student['id'] !== ''): ?><span class="student-id"><?= htmlspecialchars($student['id'], ENT_QUOTES, 'UTF-8') ?></span><?php endif; ?>
                                    </li>
                                <?php endforeach; ?>
                            </ol>
                        </article>
                    <?php endforeach; ?>
                </div>
            </section>
        <?php endif; ?>
    </main>
    <footer class="site-footer">
        <p class="footer-credit">فكرة و تطوير <strong>Abdullah Alsarmini</strong></p>
        <div class="footer-contact">
            <p class="footer-contact-title">معلومات التواصل مع المطور</p>
            <div class="footer-links">
                <a href="mailto:alsarmini7@gmail.com">alsarmini7@gmail.com</a>
                <a href="mailto:abdallahalsarmini@gmail.com">abdallahalsarmini@gmail.com</a>
                <a class="footer-facebook" href="https://www.facebook.com/share/19MyndSbJn/" target="_blank" rel="noopener noreferrer">صفحة المطور على Facebook</a>
            </div>
        </div>
    </footer>
    <script src="https://cdn.sheetjs.com/xlsx-0.20.3/package/dist/xlsx.full.min.js"></script>
    <script src="app.js"></script>
</body>
</html>