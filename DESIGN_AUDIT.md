# WB Data Frontend - Comprehensive Quality Audit Report

**Audit Date:** 2026-03-14  
**Auditor:** Quality Audit System  
**Scope:** wb-data-frontend (React + TypeScript + Vite)

---

## Anti-Patterns Verdict

### **FAIL** - This codebase exhibits multiple AI-generated design tells

### Specific Anti-Patterns Detected:

| Anti-Pattern | Location | Severity |
|-------------|----------|----------|
| **Overused Font (Inter)** | `tokens.css:37`, `index.css:106` | High |
| **Gradient Branding** | `Layout.css:39`, `DataSourceList.css:68` | Medium |
| **Card-Based Layout** | `DataSourceList.css:10-12` | Medium |
| **Generic Drop Shadows** | `tokens.css:57-60` | Medium |
| **Glassmorphism Navbar** | `Layout.css:11,17` | Medium |
| **Centered Hero Sections** | `Dashboard.tsx:8` | Low |
| **Color-Only Status Indicators** | Multiple pill components | Medium |

---

## Executive Summary

### Issue Count by Severity

| Severity | Count |
|----------|-------|
| Critical | 4 |
| High | 8 |
| Medium | 12 |
| Low | 6 |
| **Total** | **30** |

### Top Critical Issues

1. **Dual Token System Conflict** - Two competing design token systems create maintenance burden and inconsistency
2. **Missing Form Labels** - DataSourceForm has inputs without proper `<label>` associations (WCAG A violation)
3. **Incomplete Dark Mode** - Multiple hardcoded colors don't respect `[data-theme='dark']` or `.dark` variants
4. **Hardcoded Colors Throughout** - 15+ instances of non-token colors scattered across components

### Overall Quality Score: **5.5/10**

The codebase is functional but lacks design system consistency. Accessibility violations and token conflicts are the highest priority concerns.

---

## Detailed Findings by Severity

### Critical Issues

#### 1. Dual Design Token Systems

| Attribute | Value |
|-----------|-------|
| **Location** | `src/styles/tokens.css` + `src/index.css` |
| **Severity** | Critical |
| **Category** | Theming |
| **Description** | Two competing design token systems exist: custom CSS variables in `tokens.css` and Shadcn/UI OKLCH tokens in `index.css`. Components mix both systems. |
| **Impact** | Maintenance nightmare; inconsistent styling; dark mode may not work consistently across all components |
| **WCAG/Standard** | N/A |
| **Recommendation** | Consolidate to ONE token system. Prefer the Shadcn OKLCH tokens as they're more modern and accessible |
| **Suggested command** | `/normalize` to align with single design system |

**Files affected:**
- `src/index.css` (lines 36-145)
- `src/styles/tokens.css` (lines 5-77)
- `src/views/Layout.css` - uses `var(--color-*)` tokens
- `src/views/Query.css` - uses `var(--color-*)` tokens

---

#### 2. Missing Form Labels (Accessibility Violation)

| Attribute | Value |
|-----------|-------|
| **Location** | `src/views/DataSourceForm.tsx:216-246` |
| **Severity** | Critical |
| **Category** | Accessibility |
| **Description** | Form inputs lack proper `<label>` elements with `htmlFor` associations. Screen readers cannot announce input purposes. |
| **Impact** | WCAG 1.3.1 (Info and Relationships) violation. Users with visual impairments cannot understand form fields |
| **WCAG** | WCAG 1.3.1 A, WCAG 3.3.2 A |
| **Recommendation** | Add `<label htmlFor="field-id">` for each input, or use `aria-label` as fallback |
| **Suggested command** | `/harden` to add proper labeling and error handling |

**Affected inputs:**
- `host` field
- `port` field  
- `databaseName` field
- `username` field
- `password` field

---

#### 3. Incomplete Dark Mode Implementation

| Attribute | Value |
|-----------|-------|
| **Location** | Multiple CSS files |
| **Severity** | Critical |
| **Category** | Theming |
| **Description** | Hardcoded colors throughout codebase ignore dark theme. The `[data-theme='dark']` and `.dark` variants exist but aren't consistently used. |
| **Impact** | Users with dark mode enabled get broken/hidden content. Inconsistent visual experience |
| **WCAG** | WCAG 1.4.3 (Contrast) AA |
| **Recommendation** | Replace all hardcoded `#fff`, `#f5f5f5`, `#111827` colors with design tokens that respond to theme |
| **Suggested command** | `/normalize` to apply design tokens consistently |

**Examples:**
- `DataSourceList.css:48` - `color: #111827`
- `DataSourceList.css:69` - `color: #fff`
- `DataSourceForm.css:60` - `color: #1a1a1a`
- `DataSourceForm.css:67` - `color: #8c8c8c`
- `DataSourceForm.css:224` - `color: #1a1a1a`

---

#### 4. Hardcoded Colors (15+ Instances)

| Attribute | Value |
|-----------|-------|
| **Location** | Multiple CSS files |
| **Severity** | Critical |
| **Category** | Theming |
| **Description** | Direct color values instead of design tokens throughout the codebase |
| **Impact** | Cannot theme these elements; maintenance burden; potential contrast issues |
| **WCAG** | Potential WCAG 1.4.3 violations |
| **Recommendation** | Convert all hardcoded colors to design tokens |
| **Suggested command** | `/normalize` to replace with tokens |

---

### High-Severity Issues

#### 5. Overused Font Family (Inter)

| Attribute | Value |
|-----------|-------|
| **Location** | `src/styles/tokens.css:37`, `src/index.css:106` |
| **Severity** | High |
| **Category** | Anti-Pattern |
| **Description** | Uses "Inter" font - a hallmark of AI-generated designs per frontend-design skill |
| **Impact** | Unremarkable, templated appearance |
| **Recommendation** | Choose a distinctive display font paired with a refined body font |
| **Suggested command** | `/bolder` to amplify design with unique typography |

---

#### 6. Gradient Branding Elements

| Attribute | Value |
|-----------|-------|
| **Location** | `Layout.css:39`, `DataSourceList.css:68` |
| **Severity** | High |
| **Category** | Anti-Pattern |
| **Description** | Uses linear-gradient for buttons and logos - AI color palette tell |
| **Impact** | Looks templated; gradient may not maintain contrast in dark mode |
| **Recommendation** | Use solid brand colors or subtle shadows instead |
| **Suggested command** | `/quieter` to reduce visual noise |

---

#### 7. Card-Based Layout Without Purpose

| Attribute | Value |
|-----------|-------|
| **Location** | `DataSourceList.css:7-13`, `Dashboard.tsx` |
| **Severity** | High |
| **Category** | Anti-Pattern |
| **Description** | Everything wrapped in bordered card containers with shadows |
| **Impact** | Visual monotony; doesn't add meaningful hierarchy |
| **Recommendation** | Remove unnecessary containers; use spacing and layout for hierarchy |
| **Suggested command** | `/distill` to remove unnecessary containers |

---

#### 8. Missing Focus Indicators on Custom Components

| Attribute | Value |
|-----------|-------|
| **Location** | `DataSourceSelect.tsx`, custom combobox |
| **Severity** | High |
| **Category** | Accessibility |
| **Description** | Custom interactive elements may lack visible focus states |
| **Impact** | Keyboard users cannot navigate effectively |
| **WCAG** | WCAG 2.4.7 (Focus Visible) AA |
| **Recommendation** | Ensure all interactive elements have `focus-visible` styles |
| **Suggested command** | `/harden` to improve focus management |

---

#### 9. Missing ARIA Labels on Icon Buttons

| Attribute | Value |
|-----------|-------|
| **Location** | `DataSourceList.tsx:192`, `DataSourceTable.tsx` |
| **Severity** | High |
| **Category** | Accessibility |
| **Description** | Icon-only buttons without `aria-label` or accessible names |
| **Impact** | Screen reader users cannot understand button purpose |
| **WCAG** | WCAG 1.1.1 (Non-text Content) A, WCAG 4.1.2 (Name, Role, Value) A |
| **Recommendation** | Add `aria-label="Delete"` or similar to icon buttons |
| **Suggested command** | `/harden` to add ARIA labels |

---

#### 10. Dialog Without Focus Trap

| Attribute | Value |
|-----------|-------|
| **Location** | `DataSourceForm.tsx:294` |
| **Severity** | High |
| **Category** | Accessibility |
| **Description** | Modal dialog may not trap focus - users can tab outside while dialog open |
| **Impact** | Keyboard users can lose context; poor modal experience |
| **WCAG** | WCAG 2.1.2.1 (No Keyboard Trap) A |
| **Recommendation** | Verify Ark UI Dialog traps focus; add `trapFocus` if needed |
| **Suggested command** | `/harden` to verify and fix focus management |

---

#### 11. No Lazy Loading on Editor/Heavy Components

| Attribute | Value |
|-----------|-------|
| **Location** | `Query.tsx:2` - Monaco Editor |
| **Severity** | High |
| **Category** | Performance |
| **Description** | Monaco Editor (heavy ~3MB) loaded immediately on query page |
| **Impact** | Slow initial page load; unnecessary resource loading |
| **Recommendation** | Use `React.lazy()` or dynamic import with `loading` fallback |
| **Suggested command** | `/optimize` to add code splitting |

---

#### 12. Generic Drop Shadows

| Attribute | Value |
|-----------|-------|
| **Location** | `tokens.css:57-60` |
| **Severity** | High |
| **Category** | Anti-Pattern |
| **Description** | Uses generic `0 4px 12px rgba(0,0,0,0.08)` shadows common in AI outputs |
| **Impact** | Unremarkable, templated appearance |
| **Recommendation** | Create distinctive shadow system or use subtle borders instead |
| **Suggested command** | `/bolder` to create more distinctive visual identity |

---

### Medium-Severity Issues

#### 13. Glassmorphism Navbar

| Attribute | Value |
|-----------|-------|
| **Location** | `Layout.css:11,17` - `backdrop-filter: blur(14px)` |
| **Severity** | Medium |
| **Category** | Anti-Pattern |
| **Description** | Uses glassmorphism (blur + transparency) in navbar |
| **Impact** | Decorative rather than purposeful; performance cost on older devices |
| **Recommendation** | Use solid background or purpose-driven transparency |
| **Suggested command** | `/quieter` to reduce decorative effects |

---

#### 14. Loading Shimmer Animation

| Attribute | Value |
|-----------|-------|
| **Location** | `DataSourceList.css:99-106` |
| **Severity** | Medium |
| **Category | Performance |
| **Description** | Uses CSS animation for loading state |
| **Impact** | May cause layout thrashing if not carefully implemented |
| **Recommendation** | Verify animation doesn't cause reflows |
| **Suggested command** | `/optimize` to verify performance |

---

#### 15. Missing Mobile Breakpoints

| Attribute | Value |
|-----------|-------|
| **Location** | `Layout.css:181-201` |
| **Severity** | Medium |
| **Category** | Responsive |
| **Description** | Only one responsive breakpoint (900px); limited mobile adaptation |
| **Impact** | Poor experience on phones; horizontal scroll potential |
| **Recommendation** | Add more breakpoints; adapt interface for mobile contexts |
| **Suggested command** | `/adapt` to improve mobile experience |

---

#### 16. Touch Target Size Inconsistency

| Attribute | Value |
|-----------|-------|
| **Location** | Various button components |
| **Severity** | Medium |
| **Category** | Responsive |
| **Description** | Some buttons 34px height, others 44px - WCAG recommends 44x44px minimum |
| **Impact** | Difficult to tap on mobile; may miss touch targets |
| **WCAG** | WCAG 2.5.5 (Target Size) AAA |
| **Recommendation** | Standardize on 44px minimum for all interactive elements |
| **Suggested command** | `/adapt` to fix touch targets |

---

#### 17. Placeholder Text as Only Label

| Attribute | Value |
|-----------|-------|
| **Location** | `DataSourceList.tsx:179` |
| **Severity** | Medium |
| **Category** | Accessibility |
| **Description** | Search input uses placeholder as only label |
| **Impact** | Placeholder disappears on focus; users forget input purpose |
| **WCAG** | WCAG 3.3.2 (Labels or Instructions) A |
| **Recommendation** | Add visible label in addition to placeholder |
| **Suggested command** | `/harden` to improve form accessibility |

---

#### 18. No Error Boundary

| Attribute | Value |
|-----------|-------|
| **Location** | `App.tsx` |
| **Severity** | Medium |
| **Category** | Performance |
| **Description** | No React error boundary to catch render errors gracefully |
| **Impact** | Full app crashes on component errors |
| **Recommendation** | Add `<ErrorBoundary>` wrapper around routes |
| **Suggested command** | `/harden` to add error boundaries |

---

#### 19. Unused Imports/Dependencies Check

| Attribute | Value |
|-----------|-------|
| **Location** | Package.json |
| **Severity** | Medium |
| **Category** | Performance |
| **Description** | Verify no unused dependencies; some imports may be unnecessary |
| **Impact** | Larger bundle size than necessary |
| **Recommendation** | Run `npm audit` and analyze bundle |
| **Suggested command** | `/optimize` to reduce bundle size |

---

#### 20. Hardcoded Width Values

| Attribute | Value |
|-----------|-------|
| **Location** | `DataSourceForm.css:95` - `width: 1040px` |
| **Severity** | Medium |
| **Category** | Responsive |
| **Description** | Fixed width that may break on smaller screens |
| **Impact** | Horizontal scroll on narrow viewports |
| **Recommendation** | Use `max-width` with percentage or `clamp()` |
| **Suggested command** | `/adapt` to fix responsive constraints |

---

#### 21. Redundant Color Tokens

| Attribute | Value |
|-----------|-------|
| **Location** | `index.css:37-68` vs `tokens.css:5-35` |
| **Severity** | Medium |
| **Category** | Theming |
| **Description** | Duplicate color tokens in both token files |
| **Impact** | Confusion about which token to use; maintenance burden |
| **Recommendation** | Remove one token system entirely |
| **Suggested command** | `/normalize` to consolidate tokens |

---

#### 22. Inconsistent Button Styles

| Attribute | Value |
|-----------|-------|
| **Location** | Various button implementations |
| **Severity** | Medium |
| **Category** | Consistency |
| **Description** | Mix of custom CSS buttons and shadcn/ui Button component |
| **Impact** | Inconsistent user experience |
| **Recommendation** | Standardize on shadcn Button component throughout |
| **Suggested command** | `/normalize` to align component usage |

---

#### 23. Type Badge Hardcoded Colors

| Attribute | Value |
|-----------|-------|
| **Location** | `index.css:126-161` |
| **Severity** | Medium |
| **Category** | Theming |
| **Description** | Type badges use hardcoded colors, not theme-aware |
| **Impact** | May be invisible in dark mode |
| **Recommendation** | Convert to CSS custom properties |
| **Suggested command** | `/normalize` to make themable |

---

#### 24. No Reduced Motion Support

| Attribute | Value |
|-----------|-------|
| **Location** | Animations in Layout.css, DataSourceList.css |
| **Severity** | Medium |
| **Category** | Accessibility |
| **Description** | Animations don't respect `prefers-reduced-motion` |
| **Impact** | Discomfort for users with vestibular disorders |
| **WCAG** | WCAG 2.3.3 (Animation from Interactions) AAA |
| **Recommendation** | Add `@media (prefers-reduced-motion: reduce)` overrides |
| **Suggested command** | `/harden` to add motion preferences |

---

### Low-Severity Issues

#### 25. Console.log in Production Code

| Attribute | Value |
|-----------|-------|
| **Location** | `Query.tsx:101,125,139,151` |
| **Severity** | Low |
| **Category** | Code Quality |
| **Description** | `console.error` calls remain in production code |
| **Impact** | Information leakage; performance overhead |
| **Recommendation** | Use proper logging service or remove in production |
| **Suggested command** | `/polish` to clean up logging |

---

#### 26. Magic Numbers

| Attribute | Value |
|-----------|-------|
| **Location** | Various CSS and TypeScript |
| **Severity** | Low |
| **Category** | Code Quality |
| **Description** | Hardcoded numbers like `350ms` debounce, `50` page size without constants |
| **Impact** | Hard to maintain; unclear purpose |
| **Recommendation** | Extract to named constants |
| **Suggested command** | `/polish` to clean up magic numbers |

---

#### 27. Inconsistent Naming Conventions

| Attribute | Value |
|-----------|-------|
| **Location** | Mixed camelCase and kebab-case |
| **Severity** | Low |
| **Category** | Code Quality |
| **Description** | Some files use kebab-case (DataSourceList.css) vs camelCase |
| **Impact** | Confusion; inconsistent developer experience |
| **Recommendation** | Standardize on project convention |
| **Suggested command** | `/polish` to standardize naming |

---

#### 28. Unused Component - Dashboard

| Attribute | Value |
|-----------|-------|
| **Location** | `Dashboard.tsx` |
| **Severity** | Low |
| **Category** | Code Quality |
| **Description** | "Under construction" placeholder with no real functionality |
| **Impact** | Dead code; maintenance burden |
| **Recommendation** | Either implement properly or remove |
| **Suggested command** | `/distill` to remove or properly implement |

---

#### 29. Missing Loading States

| Attribute | Value |
|-----------|-------|
| **Location** | Some user actions |
| **Severity** | Low |
| **Category** | UX |
| **Description** | Some async operations lack loading indicators |
| **Impact** | User confusion; potential double-clicks |
| **Recommendation** | Add loading states to all async operations |
| **Suggested command** | `/harden` to improve loading feedback |

---

#### 30. TypeScript Any Usage

| Attribute | Value |
|-----------|-------|
| **Location** | `Query.tsx:38` - `editorRef: useRef<any>` |
| **Severity** | Low |
| **Category** | Code Quality |
| **Description** | Uses `any` type instead of proper Monaco types |
| **Impact** | Type safety compromised; potential runtime errors |
| **Recommendation** | Import proper Monaco editor types |
| **Suggested command** | `/polish` to add proper typing |

---

## Patterns & Systemic Issues

### Recurring Problems

1. **Hard-coded colors appear in 15+ components** - Should use design tokens consistently
2. **Touch targets inconsistently sized** - Mix of 34px, 42px, 44px heights throughout
3. **Dual token systems create confusion** - `var(--color-*)` vs `var(--primary)` etc.
4. **Mixed component approaches** - Some using shadcn/ui, others custom CSS
5. **Dark mode not comprehensive** - Many elements ignore theme variants
6. **Accessibility labels missing** - Icon buttons, form inputs lack proper ARIA

### Anti-Patterns Summary

| Anti-Pattern | Count | Impact |
|--------------|-------|--------|
| Overused fonts (Inter) | 2 | High |
| Gradient elements | 3 | Medium |
| Card wrappers | 5+ | Medium |
| Generic shadows | 10+ | Medium |
| Glassmorphism | 1 | Medium |
| Hardcoded colors | 15+ | Critical |

---

## Positive Findings

### What's Working Well

1. **Proper Focus Styles** - Global `:focus-visible` in `index.css:30-33` with brand color outline
2. **Semantic HTML** - Good use of `<header>`, `<main>`, `<nav>` in Layout
3. **React Query** - Excellent state management with proper caching and optimistic updates
4. **URL-Based State** - Search params for pagination and filtering - shareable URLs
5. **Debounced Search** - Proper debouncing in DataSourceList (350ms)
6. **Loading Optimizations** - `placeholderData` for smooth pagination
7. **Semantic Roles** - NavLink provides proper `aria-current` for navigation
8. **Mobile Responsive** - Basic responsive breakpoint at 900px
9. **CSS Custom Properties** - Good foundation for theming
10. **Accessibility Utility** - `.sr-only` class available for screen reader content

---

## Recommendations by Priority

### 1. Immediate (This Week)

| # | Action | Issue | Command |
|---|--------|-------|---------|
| 1 | Add form labels to DataSourceForm | #2 - WCAG violation | `/harden` |
| 2 | Consolidate to single token system | #1 - Dual tokens | `/normalize` |
| 3 | Fix hardcoded dark mode colors | #3 - Broken dark mode | `/normalize` |
| 4 | Add aria-labels to icon buttons | #9 - A11y violation | `/harden` |

### 2. Short-Term (This Sprint)

| # | Action | Issue | Command |
|---|--------|-------|---------|
| 5 | Replace Inter font with distinctive fonts | #5 - AI slop | `/bolder` |
| 6 | Remove unnecessary gradient usage | #6 - AI slop | `/quieter` |
| 7 | Add code splitting for Monaco Editor | #11 - Performance | `/optimize` |
| 8 | Add error boundary to App | #18 - Resilience | `/harden` |

### 3. Medium-Term (Next Sprint)

| # | Action | Issue | Command |
|---|--------|-------|---------|
| 9 | Replace card layouts with purposeful containers | #7 - Anti-pattern | `/distill` |
| 10 | Standardize touch targets at 44px minimum | #16 - Mobile | `/adapt` |
| 11 | Add prefers-reduced-motion support | #24 - A11y | `/harden` |
| 12 | Add mobile breakpoints | #15 - Responsive | `/adapt` |

### 4. Long-Term (Future)

| # | Action | Issue | Command |
|---|--------|-------|---------|
| 13 | Remove unused Dashboard component | #28 - Dead code | `/distill` |
| 14 | Add proper Monaco types | #30 - Types | `/polish` |
| 15 | Audit and remove console statements | #25 - Quality | `/polish` |
| 16 | Create distinctive shadow system | #12 - Design | `/bolder` |

---

## Suggested Commands for Fixes

### Map Issues to Commands

| Command | Addresses Issues | Count |
|---------|-----------------|-------|
| `/normalize` | #1, #3, #4, #21, #22, #23 | 6 |
| `/harden` | #2, #8, #9, #10, #17, #24, #29 | 7 |
| `/optimize` | #11, #14, #19 | 3 |
| `/adapt` | #15, #16, #20 | 3 |
| `/quieter` | #6, #13 | 2 |
| `/bolder` | #5, #12 | 2 |
| `/distill` | #7, #28 | 2 |
| `/polish` | #25, #26, #27, #30 | 4 |

### Recommended Order

1. **First**: `/normalize` - Fixes critical token system and dark mode issues
2. **Second**: `/harden` - Fixes accessibility violations  
3. **Third**: `/optimize` - Performance improvements
4. **Fourth**: `/adapt` - Mobile responsiveness
5. **Fifth**: `/bolder` / `/quieter` - Design improvements

---

## Conclusion

This codebase has a solid functional foundation but suffers from design system fragmentation and accessibility gaps. The dual token systems and hardcoded colors are the highest priority fixes. After addressing the critical issues, the design could be elevated with more distinctive typography and purposeful layouts.

**Next Audit Recommended**: After fixing critical issues (2 weeks)

---

*Report generated by Quality Audit System*
