// ============================================
// SUPABASE INITIALIZATION
// ============================================
const SUPABASE_URL = 'https://plghpaaxsbsuuxfmuflq.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_EfFJ4AO1Ts__Nd6S6qR0Ag_8Yvu1bYb';
const supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
let currentUser = null;
let customCategories = []; // User's custom categories from Supabase
let hiddenDefaults = []; // Hidden default category names

// ============================================
// ORIGINAL APP STATE
// ============================================
let splitId = 0;
const splits = [];
const STORAGE_KEY = 'ynab-splitter-presets';
const CATEGORIES_STORAGE_KEY = 'ynab-splitter-categories';
const HIDDEN_DEFAULTS_KEY = 'ynab-splitter-hidden-defaults';
const SPLIT_MODE_KEY = 'ynab-splitter-mode';
const DECIMAL_KEY = 'ynab-splitter-decimals';

// Split mode: 'percent' or 'amount'
let splitMode = localStorage.getItem(SPLIT_MODE_KEY) || 'percent';
// Decimal precision: 2 or 0
let decimalPrecision = parseInt(localStorage.getItem(DECIMAL_KEY)) || 2;

const totalInput = document.getElementById('totalAmount');
const splitsContainer = document.getElementById('splitsContainer');
const addSplitBtn = document.getElementById('addSplitBtn');
const savePresetBtn = document.getElementById('savePresetBtn');
const resultSection = document.getElementById('resultSection');
const resultRows = document.getElementById('resultRows');
const resultTotal = document.getElementById('resultTotal');
const statusIndicator = document.getElementById('statusIndicator');
const presetChips = document.getElementById('presetChips');
const presetModal = document.getElementById('presetModal');
const presetNameInput = document.getElementById('presetName');
const cancelPresetBtn = document.getElementById('cancelPresetBtn');
const confirmPresetBtn = document.getElementById('confirmPresetBtn');
const toast = document.getElementById('toast');
const toastMessage = document.getElementById('toastMessage');

// Auth UI elements
const authModal = document.getElementById('authModal');
const authEmail = document.getElementById('authEmail');
const authPassword = document.getElementById('authPassword');
const authError = document.getElementById('authError');
const authSuccess = document.getElementById('authSuccess');
const signInBtn = document.getElementById('signInBtn');
const signOutBtn = document.getElementById('signOutBtn');
const signInTab = document.getElementById('signInTab');
const signUpTab = document.getElementById('signUpTab');
const cancelAuthBtn = document.getElementById('cancelAuthBtn');
const confirmAuthBtn = document.getElementById('confirmAuthBtn');
const authLoggedOut = document.getElementById('authLoggedOut');
const authLoggedIn = document.getElementById('authLoggedIn');
const userEmailSpan = document.getElementById('userEmail');
const syncIndicator = document.getElementById('syncIndicator');

let isSignUpMode = false;

// Constants for validation
const MAX_AMOUNT = 999999999.99;
const MAX_PRESET_NAME_LENGTH = 50;

// Default category options for dropdown
const DEFAULT_CATEGORY_OPTIONS = [
    { group: 'Household', options: ['Partner A', 'Partner B', 'Shared', 'Personal'] },
    { group: 'Common', options: ['Groceries', 'Dining Out', 'Gas', 'Entertainment', 'Utilities', 'Rent/Mortgage', 'Transportation', 'Shopping', 'Healthcare', 'Subscriptions'] }
];

// Dynamic category options (merges defaults with custom)
let CATEGORY_OPTIONS = [...DEFAULT_CATEGORY_OPTIONS];

// ============================================
// AUTH FUNCTIONS
// ============================================
async function checkAuth() {
    try {
        const { data: { session }, error } = await supabaseClient.auth.getSession();
        if (error) throw error;
        if (session) {
            currentUser = session.user;
            updateAuthUI();
            await syncFromCloud();
        }
    } catch (err) {
        console.error('Auth check failed:', err);
    }
}

async function signIn(email, password) {
    try {
        showSyncStatus('syncing');
        const { data, error } = await supabaseClient.auth.signInWithPassword({
            email,
            password
        });
        if (error) throw error;
        currentUser = data.user;
        updateAuthUI();
        hideAuthModal();
        await syncFromCloud();
        showToast('Signed in successfully');
    } catch (err) {
        showAuthError(err.message);
    } finally {
        showSyncStatus('synced');
    }
}

async function signUp(email, password) {
    try {
        showSyncStatus('syncing');
        const { data, error } = await supabaseClient.auth.signUp({
            email,
            password
        });
        if (error) throw error;
        if (data.user && !data.session) {
            // Email confirmation required
            showAuthSuccess('Check your email to confirm your account!');
        } else if (data.session) {
            currentUser = data.user;
            updateAuthUI();
            hideAuthModal();
            // Migrate local presets to cloud
            await migrateLocalPresetsToCloud();
            showToast('Account created successfully');
        }
    } catch (err) {
        showAuthError(err.message);
    } finally {
        showSyncStatus('synced');
    }
}

async function signOut() {
    try {
        const { error } = await supabaseClient.auth.signOut();
        if (error) throw error;
        currentUser = null;
        customCategories = [];
        updateCategoryOptions();
        updateAuthUI();
        renderPresets();
        showToast('Signed out');
    } catch (err) {
        showToast('Error signing out');
        console.error(err);
    }
}

function updateAuthUI() {
    if (currentUser) {
        authLoggedOut.style.display = 'none';
        authLoggedIn.style.display = 'block';
        userEmailSpan.textContent = currentUser.email;
    } else {
        authLoggedOut.style.display = 'block';
        authLoggedIn.style.display = 'none';
        userEmailSpan.textContent = '';
    }
}

function showAuthModal() {
    authEmail.value = '';
    authPassword.value = '';
    authError.classList.remove('show');
    authSuccess.classList.remove('show');
    authModal.classList.add('show');
    authEmail.focus();
}

function hideAuthModal() {
    authModal.classList.remove('show');
    // Reset to sign-in mode when closing
    setAuthMode(false);
    authEmail.value = '';
    authPassword.value = '';
}

function showAuthError(message) {
    authError.textContent = message;
    authError.classList.add('show');
    authSuccess.classList.remove('show');
}

function showAuthSuccess(message) {
    authSuccess.textContent = message;
    authSuccess.classList.add('show');
    authError.classList.remove('show');
}

let isForgotPasswordMode = false;
let isPasswordResetMode = false;

function setAuthMode(signUp) {
    isSignUpMode = signUp;
    isForgotPasswordMode = false;
    isPasswordResetMode = false;
    const authModalTitle = document.getElementById('authModalTitle');
    const authModalSubtitle = document.getElementById('authModalSubtitle');
    const btnText = confirmAuthBtn.querySelector('span');
    const passwordGroup = document.getElementById('passwordGroup');
    const authTabs = document.querySelector('.auth-tabs');
    const forgotLink = document.getElementById('forgotPasswordLink');

    // Show password field and tabs
    if (passwordGroup) passwordGroup.style.display = 'block';
    if (authTabs) authTabs.style.display = 'flex';
    if (forgotLink) forgotLink.style.display = 'inline-block';

    if (signUp) {
        signUpTab.classList.add('active');
        signInTab.classList.remove('active');
        if (btnText) btnText.textContent = 'Create Account';
        if (authModalTitle) authModalTitle.textContent = 'Create Account';
        if (authModalSubtitle) authModalSubtitle.textContent = 'Sign up to sync your presets across devices';
        if (forgotLink) forgotLink.style.display = 'none';
    } else {
        signInTab.classList.add('active');
        signUpTab.classList.remove('active');
        if (btnText) btnText.textContent = 'Sign In';
        if (authModalTitle) authModalTitle.textContent = 'Welcome Back';
        if (authModalSubtitle) authModalSubtitle.textContent = 'Sign in to sync your presets across devices';
    }
    authError.classList.remove('show');
    authSuccess.classList.remove('show');
}

function setForgotPasswordMode() {
    isForgotPasswordMode = true;
    isSignUpMode = false;
    const authModalTitle = document.getElementById('authModalTitle');
    const authModalSubtitle = document.getElementById('authModalSubtitle');
    const btnText = confirmAuthBtn.querySelector('span');
    const passwordGroup = document.getElementById('passwordGroup');
    const authTabs = document.querySelector('.auth-tabs');

    // Hide password field and tabs
    if (passwordGroup) passwordGroup.style.display = 'none';
    if (authTabs) authTabs.style.display = 'none';

    if (authModalTitle) authModalTitle.textContent = 'Reset Password';
    if (authModalSubtitle) authModalSubtitle.textContent = 'Enter your email and we\'ll send you a reset link';
    if (btnText) btnText.textContent = 'Send Reset Link';

    authError.classList.remove('show');
    authSuccess.classList.remove('show');
}

function setPasswordResetMode() {
    isPasswordResetMode = true;
    isForgotPasswordMode = false;
    isSignUpMode = false;
    const authModalTitle = document.getElementById('authModalTitle');
    const authModalSubtitle = document.getElementById('authModalSubtitle');
    const btnText = confirmAuthBtn.querySelector('span');
    const passwordGroup = document.getElementById('passwordGroup');
    const authTabs = document.querySelector('.auth-tabs');
    const forgotLink = document.getElementById('forgotPasswordLink');

    // Show password field, hide tabs and forgot link
    if (passwordGroup) passwordGroup.style.display = 'block';
    if (authTabs) authTabs.style.display = 'none';
    if (forgotLink) forgotLink.style.display = 'none';

    // Update password label to "New Password"
    const passwordLabel = passwordGroup?.querySelector('label');
    if (passwordLabel) passwordLabel.textContent = 'New Password';
    if (authPassword) authPassword.placeholder = 'Enter your new password';

    if (authModalTitle) authModalTitle.textContent = 'Set New Password';
    if (authModalSubtitle) authModalSubtitle.textContent = 'Enter your new password below';
    if (btnText) btnText.textContent = 'Update Password';

    // Clear email field and hide it since user is already authenticated
    const emailGroup = document.querySelector('.auth-input-group');
    if (emailGroup) emailGroup.style.display = 'none';

    authError.classList.remove('show');
    authSuccess.classList.remove('show');
}

async function updatePassword(newPassword) {
    try {
        const { error } = await supabaseClient.auth.updateUser({
            password: newPassword
        });

        if (error) throw error;

        showAuthSuccess('Password updated successfully! You can now sign in.');

        // Reset to normal mode and close modal after 2 seconds
        setTimeout(() => {
            hideAuthModal();
            // Reset the password label back to normal
            const passwordGroup = document.getElementById('passwordGroup');
            const passwordLabel = passwordGroup?.querySelector('label');
            if (passwordLabel) passwordLabel.textContent = 'Password';
            if (authPassword) authPassword.placeholder = 'Enter your password';
            // Show email group again
            const emailGroup = document.querySelector('.auth-input-group');
            if (emailGroup) emailGroup.style.display = 'block';
            setAuthMode(false);
        }, 2000);

    } catch (error) {
        showAuthError(error.message);
    }
}

async function resetPassword(email) {
    try {
        const { error } = await supabaseClient.auth.resetPasswordForEmail(email, {
            redirectTo: window.location.origin + window.location.pathname
        });

        if (error) throw error;

        authSuccess.textContent = 'Password reset email sent! Check your inbox.';
        authSuccess.classList.add('show');
        authError.classList.remove('show');

        // Reset to sign in mode after 3 seconds
        setTimeout(() => {
            setAuthMode(false);
        }, 3000);

    } catch (error) {
        showAuthError(error.message);
    }
}

function showSyncStatus(status) {
    // Clear existing content safely
    while (syncIndicator.firstChild) {
        syncIndicator.removeChild(syncIndicator.firstChild);
    }

    // Create SVG icon
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('width', '12');
    svg.setAttribute('height', '12');
    svg.setAttribute('fill', 'none');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('stroke', 'currentColor');
    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute('stroke-linecap', 'round');
    path.setAttribute('stroke-linejoin', 'round');
    path.setAttribute('stroke-width', '2');

    if (status === 'syncing') {
        syncIndicator.classList.add('syncing');
        path.setAttribute('d', 'M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15');
        svg.appendChild(path);
        syncIndicator.appendChild(svg);
        syncIndicator.appendChild(document.createTextNode(' Syncing...'));
    } else {
        syncIndicator.classList.remove('syncing');
        path.setAttribute('d', 'M5 13l4 4L19 7');
        svg.appendChild(path);
        syncIndicator.appendChild(svg);
        syncIndicator.appendChild(document.createTextNode(' Synced'));
    }
}

// ============================================
// CLOUD SYNC FUNCTIONS
// ============================================
async function syncFromCloud() {
    if (!currentUser) return;
    showSyncStatus('syncing');
    try {
        await Promise.all([
            syncPresetsFromCloud(),
            syncCategoriesFromCloud()
        ]);
    } catch (err) {
        console.error('Sync failed:', err);
    } finally {
        showSyncStatus('synced');
    }
}

async function syncPresetsFromCloud() {
    if (!currentUser) return;
    try {
        const { data, error } = await supabaseClient
            .from('user_presets')
            .select('*')
            .eq('user_id', currentUser.id)
            .order('created_at', { ascending: true });
        if (error) throw error;
        // Convert cloud presets to local format and save to localStorage
        const cloudPresets = data.map(p => ({
            id: p.id,
            name: p.name,
            splits: p.splits
        }));
        localStorage.setItem(STORAGE_KEY, JSON.stringify(cloudPresets));
        renderPresets();
    } catch (err) {
        console.error('Failed to sync presets:', err);
    }
}

async function savePresetToCloud(preset) {
    if (!currentUser) return null;
    try {
        const { data, error } = await supabaseClient
            .from('user_presets')
            .insert({
                user_id: currentUser.id,
                name: preset.name,
                splits: preset.splits
            })
            .select()
            .single();
        if (error) throw error;
        return data.id;
    } catch (err) {
        console.error('Failed to save preset to cloud:', err);
        return null;
    }
}

async function deletePresetFromCloud(presetId) {
    if (!currentUser || !presetId) return;
    try {
        const { error } = await supabaseClient
            .from('user_presets')
            .delete()
            .eq('id', presetId)
            .eq('user_id', currentUser.id);
        if (error) throw error;
    } catch (err) {
        console.error('Failed to delete preset from cloud:', err);
    }
}

async function migrateLocalPresetsToCloud() {
    if (!currentUser) return;
    const localPresets = JSON.parse(localStorage.getItem(STORAGE_KEY)) || [];
    for (const preset of localPresets) {
        if (!preset.id || typeof preset.id === 'number') {
            // This is a local-only preset, migrate it
            const cloudId = await savePresetToCloud(preset);
            if (cloudId) {
                preset.id = cloudId;
            }
        }
    }
    localStorage.setItem(STORAGE_KEY, JSON.stringify(localPresets));
    await syncPresetsFromCloud();
}

// ============================================
// CUSTOM CATEGORIES SYNC
// ============================================
async function syncCategoriesFromCloud() {
    if (!currentUser) return;
    try {
        const { data, error } = await supabaseClient
            .from('user_categories')
            .select('*')
            .eq('user_id', currentUser.id)
            .order('created_at', { ascending: true });
        if (error) throw error;
        customCategories = data.map(c => ({
            id: c.id,
            name: c.name,
            group: c.group_name
        }));
        localStorage.setItem(CATEGORIES_STORAGE_KEY, JSON.stringify(customCategories));
        updateCategoryOptions();
        renderCustomCategories();
    } catch (err) {
        console.error('Failed to sync categories:', err);
    }
}

async function saveCategoryToCloud(category) {
    if (!currentUser) return null;
    try {
        const { data, error } = await supabaseClient
            .from('user_categories')
            .insert({
                user_id: currentUser.id,
                name: category.name,
                group_name: category.group || 'Custom'
            })
            .select()
            .single();
        if (error) throw error;
        return data.id;
    } catch (err) {
        console.error('Failed to save category to cloud:', err);
        return null;
    }
}

async function deleteCategoryFromCloud(categoryId) {
    if (!currentUser || !categoryId) return;
    try {
        const { error } = await supabaseClient
            .from('user_categories')
            .delete()
            .eq('id', categoryId)
            .eq('user_id', currentUser.id);
        if (error) throw error;
    } catch (err) {
        console.error('Failed to delete category from cloud:', err);
    }
}

function updateCategoryOptions() {
    // Start with default categories, filtering out hidden ones
    CATEGORY_OPTIONS = DEFAULT_CATEGORY_OPTIONS.map(group => ({
        group: group.group,
        options: group.options.filter(opt => !hiddenDefaults.includes(opt))
    })).filter(group => group.options.length > 0);

    // Add custom categories if any
    if (customCategories.length > 0) {
        const customGroup = {
            group: 'Custom',
            options: customCategories.map(c => c.name)
        };
        CATEGORY_OPTIONS.unshift(customGroup);
    }

    // Refresh all category dropdowns
    refreshAllCategorySelects();
}

function refreshAllCategorySelects() {
    const selects = splitsContainer.querySelectorAll('select');
    selects.forEach((select, index) => {
        const currentValue = select.value;
        const newSelect = createCategorySelect(currentValue);
        newSelect.addEventListener('change', (e) => {
            if (splits[index]) {
                splits[index].name = e.target.value;
                calculateSplits();
            }
        });
        select.parentNode.replaceChild(newSelect, select);
    });
}

function loadLocalCategories() {
    try {
        const stored = localStorage.getItem(CATEGORIES_STORAGE_KEY);
        if (stored) {
            customCategories = JSON.parse(stored);
            updateCategoryOptions();
            renderCustomCategories();
        }
    } catch (e) {
        customCategories = [];
    }
}

async function addCustomCategory(name) {
    if (!name.trim()) {
        showToast('Please enter a category name');
        return;
    }

    const categoryName = name.trim();

    // Check for duplicates
    const allOptions = CATEGORY_OPTIONS.flatMap(g => g.options);
    if (allOptions.includes(categoryName)) {
        showToast('Category already exists');
        return;
    }

    const newCategory = { name: categoryName, group: 'Custom' };

    if (currentUser) {
        showSyncStatus('syncing');
        const cloudId = await saveCategoryToCloud(newCategory);
        if (cloudId) {
            newCategory.id = cloudId;
        }
        showSyncStatus('synced');
    }

    customCategories.push(newCategory);
    localStorage.setItem(CATEGORIES_STORAGE_KEY, JSON.stringify(customCategories));
    updateCategoryOptions();
    renderCustomCategories();
    showToast(`Added category: ${categoryName}`);
}

async function deleteCustomCategory(index) {
    const category = customCategories[index];
    if (!category) return;

    if (currentUser && category.id) {
        showSyncStatus('syncing');
        await deleteCategoryFromCloud(category.id);
        showSyncStatus('synced');
    }

    customCategories.splice(index, 1);
    localStorage.setItem(CATEGORIES_STORAGE_KEY, JSON.stringify(customCategories));
    updateCategoryOptions();
    renderCustomCategories();
    showToast(`Deleted category: ${category.name}`);
}

function loadHiddenDefaults() {
    try {
        const stored = localStorage.getItem(HIDDEN_DEFAULTS_KEY);
        if (stored) {
            hiddenDefaults = JSON.parse(stored);
        }
    } catch (e) {
        hiddenDefaults = [];
    }
}

function hideDefaultCategory(categoryName) {
    if (hiddenDefaults.includes(categoryName)) return;

    hiddenDefaults.push(categoryName);
    localStorage.setItem(HIDDEN_DEFAULTS_KEY, JSON.stringify(hiddenDefaults));
    updateCategoryOptions();
    renderDefaultCategories();
    showToast(`Hidden category: ${categoryName}`);
}

function restoreDefaultCategory(categoryName) {
    const index = hiddenDefaults.indexOf(categoryName);
    if (index === -1) return;

    hiddenDefaults.splice(index, 1);
    localStorage.setItem(HIDDEN_DEFAULTS_KEY, JSON.stringify(hiddenDefaults));
    updateCategoryOptions();
    renderDefaultCategories();
    showToast(`Restored category: ${categoryName}`);
}

function createCategoryIcon(isRestore) {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('width', '14');
    svg.setAttribute('height', '14');
    svg.setAttribute('fill', 'none');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('stroke', 'currentColor');

    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute('stroke-linecap', 'round');
    path.setAttribute('stroke-linejoin', 'round');
    path.setAttribute('stroke-width', '2');

    if (isRestore) {
        path.setAttribute('d', 'M12 6v6m0 0v6m0-6h6m-6 0H6');
    } else {
        path.setAttribute('d', 'M6 18L18 6M6 6l12 12');
    }

    svg.appendChild(path);
    return svg;
}

function renderDefaultCategories() {
    const container = document.getElementById('defaultCategoryList');
    if (!container) return;

    // Clear existing content
    while (container.firstChild) {
        container.removeChild(container.firstChild);
    }

    // Get all default categories
    const allDefaults = DEFAULT_CATEGORY_OPTIONS.flatMap(g =>
        g.options.map(opt => ({ name: opt, group: g.group }))
    );

    allDefaults.forEach(category => {
        const isHidden = hiddenDefaults.includes(category.name);

        const chip = document.createElement('div');
        chip.className = 'default-category-chip' + (isHidden ? ' hidden-category' : '');

        const nameSpan = document.createElement('span');
        nameSpan.textContent = category.name;
        chip.appendChild(nameSpan);

        const btn = document.createElement('button');
        btn.className = 'category-toggle-btn';
        btn.setAttribute('aria-label', isHidden ? 'Restore category' : 'Hide category');
        btn.title = isHidden ? 'Restore' : 'Hide';
        btn.appendChild(createCategoryIcon(isHidden));

        if (isHidden) {
            btn.addEventListener('click', () => restoreDefaultCategory(category.name));
        } else {
            btn.addEventListener('click', () => hideDefaultCategory(category.name));
        }

        chip.appendChild(btn);
        container.appendChild(chip);
    });
}

function renderCustomCategories() {
    const container = document.getElementById('customCategoryList');
    if (!container) return;

    // Clear existing content
    while (container.firstChild) {
        container.removeChild(container.firstChild);
    }

    if (customCategories.length === 0) {
        const empty = document.createElement('span');
        empty.className = 'empty-categories';
        empty.textContent = 'No custom categories yet';
        container.appendChild(empty);
        return;
    }

    customCategories.forEach((category, index) => {
        const chip = document.createElement('div');
        chip.className = 'custom-category-chip';

        const nameSpan = document.createElement('span');
        nameSpan.textContent = category.name;
        chip.appendChild(nameSpan);

        const deleteBtn = document.createElement('button');
        deleteBtn.textContent = '\u00D7';
        deleteBtn.setAttribute('aria-label', `Delete category ${category.name}`);
        deleteBtn.addEventListener('click', () => deleteCustomCategory(index));
        chip.appendChild(deleteBtn);

        container.appendChild(chip);
    });
}

// Helper function to create SVG icons safely using DOM methods
function createSvgIcon(type, width = 12, height = 12) {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('width', String(width));
    svg.setAttribute('height', String(height));
    svg.setAttribute('fill', 'currentColor');
    svg.setAttribute('viewBox', '0 0 24 24');

    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');

    if (type === 'checkmark') {
        path.setAttribute('d', 'M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41L9 16.17z');
    } else if (type === 'warning') {
        path.setAttribute('d', 'M1 21h22L12 2 1 21zm12-3h-2v-2h2v2zm0-4h-2v-4h2v4z');
    } else if (type === 'delete') {
        svg.setAttribute('fill', 'none');
        svg.setAttribute('stroke', 'currentColor');
        path.setAttribute('stroke-linecap', 'round');
        path.setAttribute('stroke-linejoin', 'round');
        path.setAttribute('stroke-width', '2.5');
        path.setAttribute('d', 'M6 18L18 6M6 6l12 12');
    }

    svg.appendChild(path);
    return svg;
}

// Input validation helpers
function validateAndSanitizeAmount(value) {
    if (value === '' || value === null || value === undefined) {
        return 0;
    }
    // Convert to string and check for scientific notation
    const strValue = String(value);
    if (strValue.toLowerCase().includes('e')) {
        return null; // Invalid - scientific notation
    }
    const num = parseFloat(value);
    if (isNaN(num)) {
        return 0;
    }
    // Use absolute value for max check, allow negatives for refunds
    if (Math.abs(num) > MAX_AMOUNT) {
        return num > 0 ? MAX_AMOUNT : -MAX_AMOUNT;
    }
    return num;
}

// Preset management
function loadPresets() {
    try {
        return JSON.parse(localStorage.getItem(STORAGE_KEY)) || [];
    } catch (e) {
        return [];
    }
}

function savePresets(presets) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(presets));
}

function clearPresetChips() {
    while (presetChips.firstChild) {
        presetChips.removeChild(presetChips.firstChild);
    }
}

function renderPresets() {
    const presets = loadPresets();
    clearPresetChips();

    if (presets.length === 0) {
        const empty = document.createElement('div');
        empty.className = 'empty-presets';
        empty.textContent = 'No saved presets yet';
        presetChips.appendChild(empty);
        return;
    }

    presets.forEach((preset, index) => {
        const chip = document.createElement('div');
        chip.className = 'preset-chip';
        chip.setAttribute('role', 'button');
        chip.setAttribute('tabindex', '0');
        chip.setAttribute('aria-label', `Load preset ${preset.name}`);

        const label = document.createElement('span');
        label.textContent = preset.name;
        chip.appendChild(label);

        const deleteBtn = document.createElement('button');
        deleteBtn.className = 'preset-chip-delete';
        deleteBtn.textContent = '\u00D7';
        deleteBtn.setAttribute('aria-label', `Delete preset ${preset.name}`);
        deleteBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            deletePreset(index);
        });
        chip.appendChild(deleteBtn);

        chip.addEventListener('click', () => loadPreset(preset));
        chip.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                loadPreset(preset);
            }
        });

        presetChips.appendChild(chip);
    });
}

function clearSplitsContainer() {
    while (splitsContainer.firstChild) {
        splitsContainer.removeChild(splitsContainer.firstChild);
    }
}

function loadPreset(preset) {
    // Clear existing splits
    splits.length = 0;
    clearSplitsContainer();

    // Add splits from preset
    preset.splits.forEach(split => {
        addSplit(split.percent, split.name);
    });

    showToast(`Loaded preset: ${preset.name}`);
}

async function deletePreset(index) {
    const presets = loadPresets();
    const preset = presets[index];
    const presetName = preset.name;

    // Delete from cloud if logged in and has cloud ID
    if (currentUser && preset.id && typeof preset.id === 'string') {
        showSyncStatus('syncing');
        await deletePresetFromCloud(preset.id);
        showSyncStatus('synced');
    }

    presets.splice(index, 1);
    savePresets(presets);
    renderPresets();
    showToast(`Deleted preset: ${presetName}`);
}

function showPresetModal() {
    if (splits.length === 0) {
        showToast('Add some splits first');
        return;
    }
    presetNameInput.value = '';
    presetModal.classList.add('show');
    presetNameInput.focus();
}

function hidePresetModal() {
    presetModal.classList.remove('show');
}

async function saveCurrentPreset() {
    let name = presetNameInput.value.trim();
    if (!name) {
        showToast('Please enter a preset name');
        return;
    }

    // Enforce max length
    if (name.length > MAX_PRESET_NAME_LENGTH) {
        name = name.substring(0, MAX_PRESET_NAME_LENGTH);
    }

    const preset = {
        name,
        splits: splits.map(s => ({ name: s.name, percent: s.percent }))
    };

    // Save to cloud if logged in
    if (currentUser) {
        showSyncStatus('syncing');
        const cloudId = await savePresetToCloud(preset);
        if (cloudId) {
            preset.id = cloudId;
        }
        showSyncStatus('synced');
    }

    const presets = loadPresets();
    presets.push(preset);
    savePresets(presets);
    renderPresets();
    hidePresetModal();
    showToast(`Saved preset: ${name}`);
}

// Toast notification
function showToast(message) {
    toastMessage.textContent = message;
    toast.classList.add('show');
    setTimeout(() => {
        toast.classList.remove('show');
    }, 3000);
}

// Copy to clipboard
async function copyToClipboard(text, button) {
    try {
        await navigator.clipboard.writeText(text);
        const originalText = button.textContent;
        button.textContent = '\u2713 Copied';
        button.classList.add('copied');

        setTimeout(() => {
            button.textContent = originalText;
            button.classList.remove('copied');
        }, 2000);
    } catch (err) {
        showToast('Failed to copy');
    }
}

function formatCurrency(amount) {
    return new Intl.NumberFormat('en-US', {
        style: 'currency',
        currency: 'USD',
        minimumFractionDigits: decimalPrecision,
        maximumFractionDigits: decimalPrecision
    }).format(amount);
}

function adjustSplitToFull(index) {
    const totalPercent = splits.reduce((sum, s) => sum + (parseFloat(s.percent) || 0), 0);
    const remaining = 100 - totalPercent;

    if (remaining > 0 && splits[index]) {
        // Add the remaining percentage to this split
        splits[index].percent = parseFloat(splits[index].percent) + remaining;

        // Update the input field
        const splitRow = splitsContainer.children[index];
        if (splitRow) {
            const percentInput = splitRow.querySelector('input[type="number"]');
            if (percentInput) {
                percentInput.value = splits[index].percent.toFixed(1);
            }
        }

        calculateSplits();
        showToast(`Adjusted to 100%`);
    }
}

function clearResultRows() {
    while (resultRows.firstChild) {
        resultRows.removeChild(resultRows.firstChild);
    }
}

function calculateSplits() {
    const validatedAmount = validateAndSanitizeAmount(totalInput.value);

    // Handle invalid input (scientific notation)
    if (validatedAmount === null) {
        showToast('Invalid number format');
        resultSection.style.display = 'none';
        return;
    }

    const total = validatedAmount;

    // Cap the input value if it exceeds max (check absolute value)
    if (Math.abs(parseFloat(totalInput.value)) > MAX_AMOUNT) {
        totalInput.value = parseFloat(totalInput.value) > 0 ? MAX_AMOUNT : -MAX_AMOUNT;
    }

    if (total === 0 || splits.length === 0) {
        resultSection.style.display = 'none';
        return;
    }

    resultSection.style.display = 'block';
    clearResultRows();

    // Use integer math (cents) for precision
    const totalCents = Math.round(total * 100);
    let runningTotalCents = 0;
    const results = [];

    if (splitMode === 'percent') {
        // PERCENTAGE MODE
        const totalPercent = splits.reduce((sum, s) => sum + (parseFloat(s.percent) || 0), 0);
        const isFullSplit = Math.abs(totalPercent - 100) < 0.01;

        splits.forEach((split, index) => {
            const percent = parseFloat(split.percent) || 0;
            let amountCents;

            if (isFullSplit && index === splits.length - 1) {
                amountCents = totalCents - runningTotalCents;
            } else {
                amountCents = Math.round(totalCents * percent / 100);
            }

            runningTotalCents += amountCents;
            const amount = amountCents / 100;
            results.push({ name: split.name || `Split ${index + 1}`, percent, amount });
        });

        // Check if adjust button is needed
        const needsAdjust = totalPercent < 99.99;

        // Display results
        results.forEach((result, index) => {
            const row = document.createElement('div');
            row.className = 'result-row';

            const labelGroup = document.createElement('div');
            labelGroup.className = 'result-label-group';

            const nameSpan = document.createElement('span');
            nameSpan.className = 'result-label';
            nameSpan.textContent = result.name;

            const percentSpan = document.createElement('span');
            percentSpan.className = 'result-percent';
            percentSpan.textContent = `${result.percent}%`;

            labelGroup.appendChild(nameSpan);
            labelGroup.appendChild(percentSpan);

            const amountContainer = document.createElement('div');
            amountContainer.className = 'result-amount-container';

            if (needsAdjust) {
                const adjustBtn = document.createElement('button');
                adjustBtn.className = 'adjust-btn';
                adjustBtn.textContent = 'Adjust';
                adjustBtn.setAttribute('aria-label', `Adjust ${result.name} to absorb remainder`);
                adjustBtn.addEventListener('click', () => {
                    adjustSplitToFull(index);
                });
                amountContainer.appendChild(adjustBtn);
            }

            const amountSpan = document.createElement('span');
            amountSpan.className = 'result-amount';
            amountSpan.textContent = formatCurrency(result.amount);

            const copyBtn = document.createElement('button');
            copyBtn.className = 'copy-btn';
            copyBtn.textContent = 'Copy';
            copyBtn.setAttribute('aria-label', `Copy ${formatCurrency(result.amount)}`);
            copyBtn.addEventListener('click', () => {
                copyToClipboard(result.amount.toFixed(decimalPrecision), copyBtn);
            });

            amountContainer.appendChild(amountSpan);
            amountContainer.appendChild(copyBtn);

            row.appendChild(labelGroup);
            row.appendChild(amountContainer);
            resultRows.appendChild(row);
        });

        // Add remainder row if needed
        const remainingPercent = 100 - totalPercent;
        const remainingCents = totalCents - runningTotalCents;
        const remainingAmount = remainingCents / 100;

        if (remainingPercent > 0.01) {
            const remainderRow = document.createElement('div');
            remainderRow.className = 'result-row remainder-row';

            const labelGroup = document.createElement('div');
            labelGroup.className = 'result-label-group';

            const nameSpan = document.createElement('span');
            nameSpan.className = 'result-label';
            nameSpan.textContent = 'Remainder';

            const percentSpan = document.createElement('span');
            percentSpan.className = 'result-percent';
            percentSpan.textContent = `${remainingPercent.toFixed(1)}%`;

            labelGroup.appendChild(nameSpan);
            labelGroup.appendChild(percentSpan);

            const amountContainer = document.createElement('div');
            amountContainer.className = 'result-amount-container';

            const amountSpan = document.createElement('span');
            amountSpan.className = 'result-amount';
            amountSpan.textContent = formatCurrency(remainingAmount);

            const copyBtn = document.createElement('button');
            copyBtn.className = 'copy-btn';
            copyBtn.textContent = 'Copy';
            copyBtn.setAttribute('aria-label', `Copy ${formatCurrency(remainingAmount)}`);
            copyBtn.addEventListener('click', () => {
                copyToClipboard(remainingAmount.toFixed(decimalPrecision), copyBtn);
            });

            amountContainer.appendChild(amountSpan);
            amountContainer.appendChild(copyBtn);

            remainderRow.appendChild(labelGroup);
            remainderRow.appendChild(amountContainer);
            resultRows.appendChild(remainderRow);

            runningTotalCents += remainingCents;
        }

        resultTotal.textContent = formatCurrency(runningTotalCents / 100);

        // Status indicator
        while (statusIndicator.firstChild) {
            statusIndicator.removeChild(statusIndicator.firstChild);
        }
        if (Math.abs(totalPercent - 100) < 0.01) {
            statusIndicator.className = 'status-indicator status-matched';
            statusIndicator.appendChild(createSvgIcon('checkmark'));
            statusIndicator.appendChild(document.createTextNode(' 100%'));
        } else if (totalPercent < 100) {
            statusIndicator.className = 'status-indicator status-matched';
            statusIndicator.appendChild(createSvgIcon('checkmark'));
            statusIndicator.appendChild(document.createTextNode(' 100%'));
        } else {
            statusIndicator.className = 'status-indicator status-warning';
            statusIndicator.appendChild(createSvgIcon('warning'));
            statusIndicator.appendChild(document.createTextNode(' ' + totalPercent.toFixed(1) + '%'));
        }
    } else {
        // AMOUNT MODE
        const totalSplitCents = splits.reduce((sum, s) => sum + Math.round((parseFloat(s.amount) || 0) * 100), 0);
        const remainingCents = totalCents - totalSplitCents;

        splits.forEach((split, index) => {
            const amount = parseFloat(split.amount) || 0;
            const amountCents = Math.round(amount * 100);
            const percent = total !== 0 ? (amount / total * 100) : 0;

            runningTotalCents += amountCents;
            results.push({ name: split.name || `Split ${index + 1}`, percent, amount });
        });

        // Display results
        results.forEach((result, index) => {
            const row = document.createElement('div');
            row.className = 'result-row';

            const labelGroup = document.createElement('div');
            labelGroup.className = 'result-label-group';

            const nameSpan = document.createElement('span');
            nameSpan.className = 'result-label';
            nameSpan.textContent = result.name;

            const percentSpan = document.createElement('span');
            percentSpan.className = 'result-percent';
            percentSpan.textContent = `${result.percent.toFixed(1)}%`;

            labelGroup.appendChild(nameSpan);
            labelGroup.appendChild(percentSpan);

            const amountContainer = document.createElement('div');
            amountContainer.className = 'result-amount-container';

            const amountSpan = document.createElement('span');
            amountSpan.className = 'result-amount';
            amountSpan.textContent = formatCurrency(result.amount);

            const copyBtn = document.createElement('button');
            copyBtn.className = 'copy-btn';
            copyBtn.textContent = 'Copy';
            copyBtn.setAttribute('aria-label', `Copy ${formatCurrency(result.amount)}`);
            copyBtn.addEventListener('click', () => {
                copyToClipboard(result.amount.toFixed(decimalPrecision), copyBtn);
            });

            amountContainer.appendChild(amountSpan);
            amountContainer.appendChild(copyBtn);

            row.appendChild(labelGroup);
            row.appendChild(amountContainer);
            resultRows.appendChild(row);
        });

        // Add remainder row if needed
        if (remainingCents > 0) {
            const remainingAmount = remainingCents / 100;
            const remainingPercent = total !== 0 ? (remainingAmount / total * 100) : 0;

            const remainderRow = document.createElement('div');
            remainderRow.className = 'result-row remainder-row';

            const labelGroup = document.createElement('div');
            labelGroup.className = 'result-label-group';

            const nameSpan = document.createElement('span');
            nameSpan.className = 'result-label';
            nameSpan.textContent = 'Remainder';

            const percentSpan = document.createElement('span');
            percentSpan.className = 'result-percent';
            percentSpan.textContent = `${remainingPercent.toFixed(1)}%`;

            labelGroup.appendChild(nameSpan);
            labelGroup.appendChild(percentSpan);

            const amountContainer = document.createElement('div');
            amountContainer.className = 'result-amount-container';

            const amountSpan = document.createElement('span');
            amountSpan.className = 'result-amount';
            amountSpan.textContent = formatCurrency(remainingAmount);

            const copyBtn = document.createElement('button');
            copyBtn.className = 'copy-btn';
            copyBtn.textContent = 'Copy';
            copyBtn.setAttribute('aria-label', `Copy ${formatCurrency(remainingAmount)}`);
            copyBtn.addEventListener('click', () => {
                copyToClipboard(remainingAmount.toFixed(decimalPrecision), copyBtn);
            });

            amountContainer.appendChild(amountSpan);
            amountContainer.appendChild(copyBtn);

            remainderRow.appendChild(labelGroup);
            remainderRow.appendChild(amountContainer);
            resultRows.appendChild(remainderRow);

            runningTotalCents += remainingCents;
        }

        resultTotal.textContent = formatCurrency(runningTotalCents / 100);

        // Status indicator
        while (statusIndicator.firstChild) {
            statusIndicator.removeChild(statusIndicator.firstChild);
        }
        const usedPercent = total !== 0 ? (runningTotalCents / totalCents * 100) : 0;
        if (Math.abs(runningTotalCents - totalCents) < 1) {
            statusIndicator.className = 'status-indicator status-matched';
            statusIndicator.appendChild(createSvgIcon('checkmark'));
            statusIndicator.appendChild(document.createTextNode(' Matched'));
        } else if (runningTotalCents < totalCents) {
            statusIndicator.className = 'status-indicator status-matched';
            statusIndicator.appendChild(createSvgIcon('checkmark'));
            statusIndicator.appendChild(document.createTextNode(' Matched'));
        } else {
            statusIndicator.className = 'status-indicator status-warning';
            statusIndicator.appendChild(createSvgIcon('warning'));
            statusIndicator.appendChild(document.createTextNode(' Over: ' + formatCurrency((runningTotalCents - totalCents) / 100)));
        }
    }
}

function createCategorySelect(selectedValue = '') {
    const select = document.createElement('select');
    select.setAttribute('aria-label', 'Split category');

    // Add default empty option
    const defaultOption = document.createElement('option');
    defaultOption.value = '';
    defaultOption.textContent = 'Select category...';
    select.appendChild(defaultOption);

    // Add grouped options
    CATEGORY_OPTIONS.forEach(group => {
        const optgroup = document.createElement('optgroup');
        optgroup.label = group.group;

        group.options.forEach(optionText => {
            const option = document.createElement('option');
            option.value = optionText;
            option.textContent = optionText;
            if (optionText === selectedValue) {
                option.selected = true;
            }
            optgroup.appendChild(option);
        });

        select.appendChild(optgroup);
    });

    return select;
}

function applyQuickSplit(percentages) {
    // Clear existing splits
    splits.length = 0;
    clearSplitsContainer();

    // Add new splits with specified percentages
    percentages.forEach(percent => {
        addSplit(percent, '');
    });

    showToast(`Applied ${percentages.join('/')} split`);
}

function swapSplits() {
    if (splits.length < 2) {
        showToast('Need at least 2 splits to swap');
        return;
    }

    // Reverse the splits array
    splits.reverse();

    // Re-render the split inputs
    clearSplitsContainer();
    splits.forEach((split, index) => {
        const row = document.createElement('div');
        row.className = 'split-item';
        row.dataset.id = split.id;

        const categorySelect = createCategorySelect(split.name);
        categorySelect.addEventListener('change', (e) => {
            split.name = e.target.value;
            calculateSplits();
        });

        const categoryCopyBtn = document.createElement('button');
        categoryCopyBtn.className = 'category-copy-btn';
        categoryCopyBtn.title = 'Copy category name';
        categoryCopyBtn.setAttribute('aria-label', 'Copy category name');
        const copyIcon = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        copyIcon.setAttribute('width', '14');
        copyIcon.setAttribute('height', '14');
        copyIcon.setAttribute('fill', 'none');
        copyIcon.setAttribute('viewBox', '0 0 24 24');
        copyIcon.setAttribute('stroke', 'currentColor');
        const copyPath = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        copyPath.setAttribute('stroke-linecap', 'round');
        copyPath.setAttribute('stroke-linejoin', 'round');
        copyPath.setAttribute('stroke-width', '2');
        copyPath.setAttribute('d', 'M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z');
        copyIcon.appendChild(copyPath);
        categoryCopyBtn.appendChild(copyIcon);
        categoryCopyBtn.addEventListener('click', () => {
            if (categorySelect.value) {
                copyToClipboard(categorySelect.value, categoryCopyBtn);
            } else {
                showToast('Select a category first');
            }
        });

        const valueInput = document.createElement('input');
        valueInput.type = 'number';

        if (splitMode === 'percent') {
            valueInput.placeholder = '%';
            valueInput.value = split.percent;
            valueInput.min = '0';
            valueInput.max = '100';
            valueInput.step = '0.1';
            valueInput.setAttribute('aria-label', 'Split percentage');
            valueInput.addEventListener('input', (e) => {
                split.percent = parseFloat(e.target.value) || 0;
                calculateSplits();
            });
        } else {
            valueInput.placeholder = '$';
            valueInput.value = split.amount || '';
            valueInput.min = '0';
            valueInput.step = '0.01';
            valueInput.setAttribute('aria-label', 'Split amount');
            valueInput.addEventListener('input', (e) => {
                split.amount = parseFloat(e.target.value) || 0;
                calculateSplits();
            });
        }

        const deleteBtn = document.createElement('button');
        deleteBtn.className = 'btn btn-danger';
        deleteBtn.appendChild(createSvgIcon('delete', 18, 18));
        deleteBtn.setAttribute('aria-label', 'Delete split');
        deleteBtn.addEventListener('click', () => {
            const idx = splits.findIndex(s => s.id === split.id);
            if (idx > -1) splits.splice(idx, 1);
            row.remove();
            calculateSplits();
        });

        row.appendChild(categorySelect);
        row.appendChild(categoryCopyBtn);
        row.appendChild(valueInput);
        row.appendChild(deleteBtn);
        splitsContainer.appendChild(row);
    });

    calculateSplits();
    showToast('Splits swapped');
}

function addSplit(defaultValue = 50, defaultName = '') {
    const id = splitId++;
    const split = {
        id,
        name: defaultName,
        percent: splitMode === 'percent' ? defaultValue : 0,
        amount: splitMode === 'amount' ? defaultValue : 0
    };
    splits.push(split);

    const row = document.createElement('div');
    row.className = 'split-item';
    row.dataset.id = id;

    const categorySelect = createCategorySelect(defaultName);
    categorySelect.addEventListener('change', (e) => {
        split.name = e.target.value;
        calculateSplits();
    });

    const categoryCopyBtn = document.createElement('button');
    categoryCopyBtn.className = 'category-copy-btn';
    categoryCopyBtn.title = 'Copy category name';
    categoryCopyBtn.setAttribute('aria-label', 'Copy category name');
    const copyIcon = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    copyIcon.setAttribute('width', '14');
    copyIcon.setAttribute('height', '14');
    copyIcon.setAttribute('fill', 'none');
    copyIcon.setAttribute('viewBox', '0 0 24 24');
    copyIcon.setAttribute('stroke', 'currentColor');
    const copyPath = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    copyPath.setAttribute('stroke-linecap', 'round');
    copyPath.setAttribute('stroke-linejoin', 'round');
    copyPath.setAttribute('stroke-width', '2');
    copyPath.setAttribute('d', 'M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z');
    copyIcon.appendChild(copyPath);
    categoryCopyBtn.appendChild(copyIcon);
    categoryCopyBtn.addEventListener('click', () => {
        if (categorySelect.value) {
            copyToClipboard(categorySelect.value, categoryCopyBtn);
        } else {
            showToast('Select a category first');
        }
    });

    const valueInput = document.createElement('input');
    valueInput.type = 'number';

    if (splitMode === 'percent') {
        valueInput.placeholder = '%';
        valueInput.value = defaultValue;
        valueInput.min = '0';
        valueInput.max = '100';
        valueInput.step = '0.1';
        valueInput.setAttribute('aria-label', 'Split percentage');
        valueInput.addEventListener('input', (e) => {
            split.percent = parseFloat(e.target.value) || 0;
            calculateSplits();
        });
    } else {
        valueInput.placeholder = '$';
        valueInput.value = defaultValue || '';
        valueInput.min = '0';
        valueInput.step = '0.01';
        valueInput.setAttribute('aria-label', 'Split amount');
        valueInput.addEventListener('input', (e) => {
            split.amount = parseFloat(e.target.value) || 0;
            calculateSplits();
        });
    }

    const deleteBtn = document.createElement('button');
    deleteBtn.className = 'btn btn-danger';
    deleteBtn.appendChild(createSvgIcon('delete', 18, 18));
    deleteBtn.setAttribute('aria-label', 'Delete split');
    deleteBtn.addEventListener('click', () => {
        const index = splits.findIndex(s => s.id === id);
        if (index > -1) splits.splice(index, 1);
        row.remove();
        calculateSplits();
    });

    row.appendChild(categorySelect);
    row.appendChild(categoryCopyBtn);
    row.appendChild(valueInput);
    row.appendChild(deleteBtn);
    splitsContainer.appendChild(row);

    if (!defaultName) {
        categorySelect.focus();
    }
    calculateSplits();
}

// Event listeners
const swapSplitsBtn = document.getElementById('swapSplitsBtn');

// Prevent scientific notation in total amount input
totalInput.addEventListener('keydown', (e) => {
    if (e.key === 'e' || e.key === 'E') {
        e.preventDefault();
    }
});
totalInput.addEventListener('input', calculateSplits);
addSplitBtn.addEventListener('click', () => addSplit(50, ''));
swapSplitsBtn.addEventListener('click', swapSplits);
savePresetBtn.addEventListener('click', showPresetModal);
cancelPresetBtn.addEventListener('click', hidePresetModal);
confirmPresetBtn.addEventListener('click', saveCurrentPreset);

presetNameInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
        saveCurrentPreset();
    } else if (e.key === 'Escape') {
        hidePresetModal();
    }
});

presetModal.addEventListener('click', (e) => {
    if (e.target === presetModal) {
        hidePresetModal();
    }
});

// Keyboard accessibility
document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && presetModal.classList.contains('show')) {
        hidePresetModal();
    }
});

// Theme toggle
const themeToggle = document.getElementById('themeToggle');
const THEME_KEY = 'ynab-splitter-theme';

function loadTheme() {
    const savedTheme = localStorage.getItem(THEME_KEY);
    if (savedTheme) {
        document.documentElement.setAttribute('data-theme', savedTheme);
    }
}

function toggleTheme() {
    const currentTheme = document.documentElement.getAttribute('data-theme');
    const newTheme = currentTheme === 'light' ? 'dark' : 'light';

    if (newTheme === 'dark') {
        document.documentElement.removeAttribute('data-theme');
    } else {
        document.documentElement.setAttribute('data-theme', newTheme);
    }

    localStorage.setItem(THEME_KEY, newTheme);
}

themeToggle.addEventListener('click', toggleTheme);

// ============================================
// AUTH EVENT LISTENERS
// ============================================
signInBtn.addEventListener('click', showAuthModal);
signOutBtn.addEventListener('click', signOut);
cancelAuthBtn.addEventListener('click', hideAuthModal);

signInTab.addEventListener('click', () => setAuthMode(false));
signUpTab.addEventListener('click', () => setAuthMode(true));

// Forgot password link
const forgotPasswordLink = document.getElementById('forgotPasswordLink');
if (forgotPasswordLink) {
    forgotPasswordLink.addEventListener('click', (e) => {
        e.preventDefault();
        setForgotPasswordMode();
    });
}

confirmAuthBtn.addEventListener('click', () => {
    const email = authEmail.value.trim();
    const password = authPassword.value;

    // Handle password reset mode (user clicked email link)
    if (isPasswordResetMode) {
        if (!password) {
            showAuthError('Please enter your new password');
            return;
        }
        if (password.length < 6) {
            showAuthError('Password must be at least 6 characters');
            return;
        }
        updatePassword(password);
        return;
    }

    // Handle forgot password mode
    if (isForgotPasswordMode) {
        if (!email) {
            showAuthError('Please enter your email address');
            return;
        }
        resetPassword(email);
        return;
    }

    if (!email || !password) {
        showAuthError('Please enter email and password');
        return;
    }
    if (password.length < 6) {
        showAuthError('Password must be at least 6 characters');
        return;
    }
    if (isSignUpMode) {
        signUp(email, password);
    } else {
        signIn(email, password);
    }
});

authEmail.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
        if (isForgotPasswordMode) {
            confirmAuthBtn.click();
        } else {
            authPassword.focus();
        }
    } else if (e.key === 'Escape') {
        hideAuthModal();
    }
});

authPassword.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
        confirmAuthBtn.click();
    } else if (e.key === 'Escape') {
        hideAuthModal();
    }
});

authModal.addEventListener('click', (e) => {
    if (e.target === authModal) {
        hideAuthModal();
    }
});

// ============================================
// CUSTOM CATEGORIES EVENT LISTENERS
// ============================================
const newCategoryInput = document.getElementById('newCategoryInput');
const addCategoryBtn = document.getElementById('addCategoryBtn');

addCategoryBtn.addEventListener('click', () => {
    addCustomCategory(newCategoryInput.value);
    newCategoryInput.value = '';
});

newCategoryInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
        addCustomCategory(newCategoryInput.value);
        newCategoryInput.value = '';
    }
});

// ============================================
// QUICK SPLIT BUTTONS EVENT LISTENERS
// ============================================
document.querySelectorAll('.quick-split-chip[data-split]').forEach(btn => {
    btn.addEventListener('click', () => {
        const splitValues = btn.dataset.split.split(',').map(Number);
        applyQuickSplit(splitValues);
    });
});

// ============================================
// USER GUIDE MODAL
// ============================================
const guideModal = document.getElementById('guideModal');
const helpToggle = document.getElementById('helpToggle');
const closeGuideBtn = document.getElementById('closeGuideBtn');
const closeGuideFooterBtn = document.getElementById('closeGuideFooterBtn');

function showGuideModal() {
    guideModal.classList.add('show');
}

function hideGuideModal() {
    guideModal.classList.remove('show');
}

if (helpToggle) {
    helpToggle.addEventListener('click', showGuideModal);
}

if (closeGuideBtn) {
    closeGuideBtn.addEventListener('click', hideGuideModal);
}

if (closeGuideFooterBtn) {
    closeGuideFooterBtn.addEventListener('click', hideGuideModal);
}

if (guideModal) {
    guideModal.addEventListener('click', (e) => {
        if (e.target === guideModal) {
            hideGuideModal();
        }
    });
}

// ============================================
// PRIVACY POLICY MODAL
// ============================================
const privacyModal = document.getElementById('privacyModal');
const privacyPolicyLink = document.getElementById('privacyPolicyLink');
const closePrivacyBtn = document.getElementById('closePrivacyBtn');
const acceptPrivacyBtn = document.getElementById('acceptPrivacyBtn');

function showPrivacyModal() {
    privacyModal.classList.add('show');
}

function hidePrivacyModal() {
    privacyModal.classList.remove('show');
}

if (privacyPolicyLink) {
    privacyPolicyLink.addEventListener('click', (e) => {
        e.preventDefault();
        showPrivacyModal();
    });
}

if (closePrivacyBtn) {
    closePrivacyBtn.addEventListener('click', hidePrivacyModal);
}

if (acceptPrivacyBtn) {
    acceptPrivacyBtn.addEventListener('click', hidePrivacyModal);
}

if (privacyModal) {
    privacyModal.addEventListener('click', (e) => {
        if (e.target === privacyModal) {
            hidePrivacyModal();
        }
    });
}

// ============================================
// SETTINGS: SPLIT MODE & DECIMAL PRECISION
// ============================================
const splitModeToggle = document.getElementById('splitModeToggle');
const decimalToggle = document.getElementById('decimalToggle');
const splitsHeaderTitle = document.getElementById('splitsHeaderTitle');
const splitByPeopleBtn = document.getElementById('splitByPeopleBtn');
const splitPeopleCount = document.getElementById('splitPeopleCount');

function setSplitMode(mode) {
    splitMode = mode;
    localStorage.setItem(SPLIT_MODE_KEY, mode);

    // Update toggle buttons
    if (splitModeToggle) {
        splitModeToggle.querySelectorAll('.toggle-option').forEach(btn => {
            btn.classList.toggle('active', btn.dataset.mode === mode);
        });
    }

    // Update header title
    if (splitsHeaderTitle) {
        splitsHeaderTitle.textContent = mode === 'percent' ? 'Split Percentages' : 'Split Amounts';
    }

    // Re-render splits with new mode
    rerenderAllSplits();
}

function setDecimalPrecision(decimals) {
    decimalPrecision = parseInt(decimals);
    localStorage.setItem(DECIMAL_KEY, decimals);

    // Update toggle buttons
    if (decimalToggle) {
        decimalToggle.querySelectorAll('.toggle-option').forEach(btn => {
            btn.classList.toggle('active', btn.dataset.decimals === String(decimals));
        });
    }

    // Recalculate to update display
    calculateSplits();
}

function rerenderAllSplits() {
    // Store current values
    const currentSplits = splits.map(s => ({ ...s }));

    // Clear and re-render
    splits.length = 0;
    clearSplitsContainer();

    currentSplits.forEach(split => {
        if (splitMode === 'percent') {
            addSplit(split.percent, split.name);
        } else {
            // In amount mode, use the stored amount value
            addSplit(split.amount || 0, split.name);
        }
    });
}

// Split by number of people
function splitByPeople(count) {
    if (count < 2 || count > 10) {
        showToast('Enter a number between 2 and 10');
        return;
    }

    // Clear existing splits
    splits.length = 0;
    clearSplitsContainer();

    if (splitMode === 'percent') {
        // Equal percentage split
        const percentPerPerson = Math.floor(100 / count * 10) / 10; // One decimal place
        const remainder = 100 - (percentPerPerson * count);

        for (let i = 0; i < count; i++) {
            // Give remainder to first person
            const percent = i === 0 ? percentPerPerson + remainder : percentPerPerson;
            addSplit(parseFloat(percent.toFixed(1)), '');
        }
    } else {
        // Equal amount split
        const total = validateAndSanitizeAmount(totalInput.value) || 0;
        const amountPerPerson = Math.floor(total / count * 100) / 100;
        const remainder = Math.round((total - (amountPerPerson * count)) * 100) / 100;

        for (let i = 0; i < count; i++) {
            const amount = i === 0 ? amountPerPerson + remainder : amountPerPerson;
            addSplit(parseFloat(amount.toFixed(2)), '');
        }
    }

    showToast(`Split equally between ${count} people`);
}

// Initialize split mode toggle
if (splitModeToggle) {
    splitModeToggle.querySelectorAll('.toggle-option').forEach(btn => {
        btn.addEventListener('click', () => {
            setSplitMode(btn.dataset.mode);
        });
        // Set initial active state
        btn.classList.toggle('active', btn.dataset.mode === splitMode);
    });
}

// Initialize decimal toggle
if (decimalToggle) {
    decimalToggle.querySelectorAll('.toggle-option').forEach(btn => {
        btn.addEventListener('click', () => {
            setDecimalPrecision(btn.dataset.decimals);
        });
        // Set initial active state
        btn.classList.toggle('active', btn.dataset.decimals === String(decimalPrecision));
    });
}

// Initialize split by people
if (splitByPeopleBtn && splitPeopleCount) {
    splitByPeopleBtn.addEventListener('click', () => {
        const count = parseInt(splitPeopleCount.value) || 2;
        splitByPeople(count);
    });

    splitPeopleCount.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
            const count = parseInt(splitPeopleCount.value) || 2;
            splitByPeople(count);
        }
    });
}

// Update header title based on initial mode
if (splitsHeaderTitle) {
    splitsHeaderTitle.textContent = splitMode === 'percent' ? 'Split Percentages' : 'Split Amounts';
}

// ============================================
// KEYBOARD SHORTCUTS
// ============================================
document.addEventListener('keydown', (e) => {
    // Ignore if in an input/textarea
    const tagName = document.activeElement.tagName.toLowerCase();
    const isInput = tagName === 'input' || tagName === 'textarea' || tagName === 'select';

    // Escape key - close any open modal
    if (e.key === 'Escape') {
        if (presetModal.classList.contains('show')) {
            hidePresetModal();
        } else if (authModal.classList.contains('show')) {
            hideAuthModal();
        } else if (guideModal && guideModal.classList.contains('show')) {
            hideGuideModal();
        } else if (privacyModal && privacyModal.classList.contains('show')) {
            hidePrivacyModal();
        }
        return;
    }

    // Only process shortcuts when not in input
    if (isInput) {
        // Enter in total amount field - focus first split
        if (e.key === 'Enter' && document.activeElement === totalInput) {
            e.preventDefault();
            const firstSplitInput = splitsContainer.querySelector('input[type="number"]');
            if (firstSplitInput) {
                firstSplitInput.focus();
                firstSplitInput.select();
            }
        }
        return;
    }

    // Ctrl/Cmd + S - Save preset
    if ((e.ctrlKey || e.metaKey) && e.key === 's') {
        e.preventDefault();
        showPresetModal();
        return;
    }

    // Ctrl/Cmd + N - Add new split
    if ((e.ctrlKey || e.metaKey) && e.key === 'n') {
        e.preventDefault();
        addSplitBtn.click();
        return;
    }

    // ? - Show help
    if (e.key === '?' && !e.shiftKey) {
        e.preventDefault();
        showGuideModal();
        return;
    }

    // Number keys 1-3 for quick splits (when not in input)
    if (e.key === '1' && !e.ctrlKey && !e.metaKey) {
        applyQuickSplit([50, 50]);
    } else if (e.key === '2' && !e.ctrlKey && !e.metaKey) {
        applyQuickSplit([60, 40]);
    } else if (e.key === '3' && !e.ctrlKey && !e.metaKey) {
        applyQuickSplit([70, 30]);
    }
});

// ============================================
// SYSTEM THEME DETECTION
// ============================================
const THEME_PREFERENCE_KEY = 'ynab-splitter-theme-preference';

function getSystemTheme() {
    return window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
}

function applyTheme(theme) {
    if (theme === 'dark') {
        document.documentElement.removeAttribute('data-theme');
    } else {
        document.documentElement.setAttribute('data-theme', theme);
    }
}

function initTheme() {
    const savedPreference = localStorage.getItem(THEME_PREFERENCE_KEY);
    const savedTheme = localStorage.getItem(THEME_KEY);

    // If user has never explicitly set a theme, use system preference
    if (!savedPreference && !savedTheme) {
        const systemTheme = getSystemTheme();
        applyTheme(systemTheme);
        // Don't save to localStorage - let it follow system
    } else if (savedTheme) {
        applyTheme(savedTheme);
    }
}

// Listen for system theme changes
window.matchMedia('(prefers-color-scheme: light)').addEventListener('change', (e) => {
    // Only auto-switch if user hasn't explicitly set a preference
    const savedPreference = localStorage.getItem(THEME_PREFERENCE_KEY);
    if (!savedPreference) {
        const newTheme = e.matches ? 'light' : 'dark';
        applyTheme(newTheme);
    }
});

// Update toggleTheme to mark user preference
function toggleThemeWithPreference() {
    const currentTheme = document.documentElement.getAttribute('data-theme');
    const newTheme = currentTheme === 'light' ? 'dark' : 'light';

    applyTheme(newTheme);
    localStorage.setItem(THEME_KEY, newTheme);
    localStorage.setItem(THEME_PREFERENCE_KEY, 'manual'); // Mark as manually set
}

// Replace the theme toggle listener
themeToggle.removeEventListener('click', toggleTheme);
themeToggle.addEventListener('click', toggleThemeWithPreference);

// ============================================
// INITIALIZE
// ============================================
initTheme(); // Use new theme initialization
loadLocalCategories();
loadHiddenDefaults();
updateCategoryOptions(); // Refresh after loading hidden defaults
renderPresets();
renderCustomCategories();
renderDefaultCategories();

// Listen for auth state changes (including password recovery)
supabaseClient.auth.onAuthStateChange((event, session) => {
    if (event === 'PASSWORD_RECOVERY') {
        // User clicked the password reset link in their email
        showAuthModal();
        setPasswordResetMode();
    }
});

// Check for existing auth session
checkAuth();

// Start with two 50% splits
addSplit(splitMode === 'percent' ? 50 : 0, '');
addSplit(splitMode === 'percent' ? 50 : 0, '');
