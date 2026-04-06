import fs from 'fs';

let css = fs.readFileSync('src/views/UserList.css', 'utf-8');

css = css.replace(/user-/g, 'group-');

// Update width constraints
css = css.replace(/min-width: 900px;/g, 'min-width: 720px;');
css = css.replace(/width: min\(620px, 100\%\);/g, 'width: min(480px, 100%);');
css = css.replace(/grid-template-columns: repeat\(2, minmax\(0, 1fr\)\);/g, 'grid-template-columns: minmax(0, 1fr);');

// Remove some sections roughly
css = css.replace(/\.group-form-password-field[\s\S]*?(?=\.group-form-divider)/g, '');
css = css.replace(/\.group-reset-dialog-card[\s\S]*?(?=\.group-form-header)/g, '');
css = css.replace(/\.group-reset-description[\s\S]*?(?=@media)/g, '');

// Clean everything after Group Assignment Rows
const groupRowsIdx = css.indexOf('/* ── Group Assignment Rows ── */');
if (groupRowsIdx !== -1) {
    css = css.substring(0, groupRowsIdx);
}

// Add the textarea block
css += `
.group-form-input-group textarea {
    height: auto;
    min-height: 80px;
    padding: 10px 12px;
    resize: vertical;
    font-family: var(--font-sans);
    line-height: 1.5;
}
`;

fs.writeFileSync('src/views/GroupList.css', css);
