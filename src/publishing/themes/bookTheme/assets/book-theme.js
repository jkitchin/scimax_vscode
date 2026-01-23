/**
 * Book Theme JavaScript
 * Handles interactivity: dark mode, mobile sidebar, navigation, scroll spy
 */

(function() {
    'use strict';

    // ==========================================================================
    // Dark Mode Toggle
    // ==========================================================================

    const THEME_KEY = 'scimax-theme';

    /**
     * Initialize theme handling
     */
    function initTheme() {
        const toggle = document.getElementById('theme-toggle');
        if (!toggle) return;

        // Load saved theme or use default
        const savedTheme = localStorage.getItem(THEME_KEY);
        if (savedTheme) {
            document.documentElement.setAttribute('data-theme', savedTheme);
        }

        // Toggle theme on click
        toggle.addEventListener('click', () => {
            const currentTheme = document.documentElement.getAttribute('data-theme');
            let newTheme;

            if (currentTheme === 'auto') {
                // Auto -> light
                newTheme = 'light';
            } else if (currentTheme === 'light') {
                // Light -> dark
                newTheme = 'dark';
            } else {
                // Dark -> auto
                newTheme = 'auto';
            }

            document.documentElement.setAttribute('data-theme', newTheme);
            localStorage.setItem(THEME_KEY, newTheme);
        });
    }

    // ==========================================================================
    // Mobile Sidebar
    // ==========================================================================

    /**
     * Initialize mobile sidebar toggle
     */
    function initMobileSidebar() {
        const toggle = document.getElementById('mobile-menu-toggle');
        const sidebar = document.getElementById('sidebar-left');

        if (!toggle || !sidebar) return;

        // Create overlay
        const overlay = document.createElement('div');
        overlay.className = 'sidebar-overlay';
        document.body.appendChild(overlay);

        // Toggle sidebar
        toggle.addEventListener('click', () => {
            sidebar.classList.toggle('open');
            overlay.classList.toggle('visible');
            document.body.style.overflow = sidebar.classList.contains('open') ? 'hidden' : '';
        });

        // Close on overlay click
        overlay.addEventListener('click', () => {
            sidebar.classList.remove('open');
            overlay.classList.remove('visible');
            document.body.style.overflow = '';
        });

        // Close on escape key
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape' && sidebar.classList.contains('open')) {
                sidebar.classList.remove('open');
                overlay.classList.remove('visible');
                document.body.style.overflow = '';
            }
        });
    }

    // ==========================================================================
    // Collapsible Navigation
    // ==========================================================================

    /**
     * Initialize collapsible navigation sections
     */
    function initCollapsibleNav() {
        // Part toggles
        const partToggles = document.querySelectorAll('.nav-part-toggle');
        partToggles.forEach(toggle => {
            toggle.addEventListener('click', () => {
                const part = toggle.closest('.nav-part');
                const chapters = part.querySelector('.part-chapters');
                const icon = toggle.querySelector('.toggle-icon');
                const isExpanded = toggle.getAttribute('aria-expanded') === 'true';

                toggle.setAttribute('aria-expanded', !isExpanded);
                chapters.classList.toggle('collapsed', isExpanded);
                chapters.classList.toggle('expanded', !isExpanded);
                icon.innerHTML = isExpanded ? '&#9654;' : '&#9660;';
            });
        });

        // Item toggles
        const navToggles = document.querySelectorAll('.nav-toggle');
        navToggles.forEach(toggle => {
            toggle.addEventListener('click', () => {
                const item = toggle.closest('.nav-item');
                const children = item.querySelector('.nav-children');
                const icon = toggle.querySelector('.toggle-icon');
                const isExpanded = toggle.getAttribute('aria-expanded') === 'true';

                toggle.setAttribute('aria-expanded', !isExpanded);
                children.classList.toggle('collapsed', isExpanded);
                children.classList.toggle('expanded', !isExpanded);
                icon.innerHTML = isExpanded ? '&#9654;' : '&#9660;';
            });
        });

        // Save navigation state
        saveNavState();
    }

    /**
     * Save and restore navigation state
     */
    function saveNavState() {
        const NAV_STATE_KEY = 'scimax-nav-state';

        // Load saved state
        try {
            const saved = localStorage.getItem(NAV_STATE_KEY);
            if (saved) {
                const state = JSON.parse(saved);
                // Apply saved collapsed states
                // (Implementation depends on how we identify nav items)
            }
        } catch (e) {
            // Ignore errors
        }

        // Save state on changes
        document.querySelectorAll('.nav-toggle, .nav-part-toggle').forEach(toggle => {
            toggle.addEventListener('click', () => {
                // Debounce save
                clearTimeout(window._navSaveTimeout);
                window._navSaveTimeout = setTimeout(() => {
                    const state = {};
                    // Collect current states
                    // (Implementation depends on how we identify nav items)
                    localStorage.setItem(NAV_STATE_KEY, JSON.stringify(state));
                }, 500);
            });
        });
    }

    // ==========================================================================
    // Scroll Spy for Page TOC
    // ==========================================================================

    /**
     * Initialize scroll spy to highlight current section in TOC
     */
    function initScrollSpy() {
        const tocLinks = document.querySelectorAll('.toc-link');
        if (tocLinks.length === 0) return;

        // Get all headings that have TOC entries
        const headingIds = Array.from(tocLinks).map(link => {
            const href = link.getAttribute('href');
            return href ? href.slice(1) : null; // Remove #
        }).filter(Boolean);

        const headings = headingIds
            .map(id => document.getElementById(id))
            .filter(Boolean);

        if (headings.length === 0) return;

        // Throttled scroll handler
        let ticking = false;

        const onScroll = () => {
            if (ticking) return;
            ticking = true;

            requestAnimationFrame(() => {
                updateActiveHeading(headings, tocLinks);
                ticking = false;
            });
        };

        window.addEventListener('scroll', onScroll, { passive: true });

        // Initial call
        updateActiveHeading(headings, tocLinks);
    }

    /**
     * Update active heading based on scroll position
     */
    function updateActiveHeading(headings, tocLinks) {
        const scrollPos = window.scrollY + 100; // Offset for header

        let activeIndex = 0;

        for (let i = 0; i < headings.length; i++) {
            if (headings[i].offsetTop <= scrollPos) {
                activeIndex = i;
            }
        }

        // Update TOC active state
        tocLinks.forEach((link, i) => {
            link.classList.toggle('active', i === activeIndex);
        });
    }

    // ==========================================================================
    // Search (Lunr.js integration)
    // ==========================================================================

    let searchIndex = null;
    let searchDocuments = {};
    let lunrIndex = null;

    /**
     * Initialize search functionality
     */
    function initSearch() {
        const searchInput = document.getElementById('search-input');
        const searchResults = document.getElementById('search-results');

        if (!searchInput || !searchResults) return;

        // Load search index
        loadSearchIndex().then(success => {
            if (!success) {
                if (window.location.protocol === 'file:') {
                    searchInput.placeholder = 'Search requires web server';
                    searchInput.title = 'Search is not available when viewing files directly. Use: python -m http.server';
                } else {
                    searchInput.placeholder = 'Search unavailable';
                }
                searchInput.disabled = true;
                return;
            }

            // Set up event listeners
            searchInput.addEventListener('input', debounce(handleSearch, 200));
            searchInput.addEventListener('focus', () => {
                if (searchInput.value.length > 1) {
                    searchResults.classList.add('visible');
                }
            });

            // Close results when clicking outside
            document.addEventListener('click', (e) => {
                if (!searchInput.contains(e.target) && !searchResults.contains(e.target)) {
                    searchResults.classList.remove('visible');
                }
            });

            // Handle keyboard navigation
            searchInput.addEventListener('keydown', handleKeyNavigation);
        });
    }

    /**
     * Load the search index
     */
    async function loadSearchIndex() {
        try {
            // Check if we're on a file:// URL - fetch doesn't work there
            if (window.location.protocol === 'file:') {
                console.warn('Search is not available when viewing files directly. Use a local web server.');
                return false;
            }

            // Check if Lunr is available
            if (typeof lunr === 'undefined') {
                // Load Lunr.js from CDN
                await loadScript('https://cdn.jsdelivr.net/npm/lunr@2.3.9/lunr.min.js');
            }

            // Get path to root
            const pathToRoot = getPathToRoot();
            const response = await fetch(pathToRoot + '_static/search-index.json');

            if (!response.ok) {
                console.warn('Search index not found');
                return false;
            }

            const data = await response.json();

            // Build document lookup
            for (const doc of data.documents) {
                searchDocuments[doc.id] = doc;
            }

            // Build Lunr index
            lunrIndex = lunr(function() {
                this.ref('id');
                this.field('title', { boost: 10 });
                this.field('headings', { boost: 5 });
                this.field('content');

                for (const doc of data.documents) {
                    this.add(doc);
                }
            });

            searchIndex = data;
            return true;
        } catch (error) {
            console.error('Failed to load search index:', error);
            return false;
        }
    }

    /**
     * Load a script dynamically
     */
    function loadScript(src) {
        return new Promise((resolve, reject) => {
            const script = document.createElement('script');
            script.src = src;
            script.onload = resolve;
            script.onerror = reject;
            document.head.appendChild(script);
        });
    }

    /**
     * Handle search input
     */
    function handleSearch(event) {
        const query = event.target.value.trim();
        const resultsContainer = document.getElementById('search-results');

        if (query.length < 2) {
            resultsContainer.classList.remove('visible');
            resultsContainer.innerHTML = '';
            return;
        }

        if (!lunrIndex) return;

        try {
            // Search with wildcard for partial matches
            const results = lunrIndex.search(query + '*');
            displayResults(results, query);
        } catch (error) {
            // Handle Lunr search errors gracefully
            displayResults([], query);
        }
    }

    /**
     * Display search results
     */
    function displayResults(results, query) {
        const resultsContainer = document.getElementById('search-results');
        const pathToRoot = getPathToRoot();

        if (results.length === 0) {
            resultsContainer.innerHTML = '<div class="search-no-results">No results found</div>';
            resultsContainer.classList.add('visible');
            return;
        }

        const html = results.slice(0, 10).map((result, index) => {
            const doc = searchDocuments[result.ref];
            if (!doc) return '';

            const title = highlightText(doc.title, query);
            const snippet = getSnippet(doc.content, query);

            return `
                <a href="${pathToRoot}${doc.id}" class="search-result-item${index === 0 ? ' selected' : ''}" data-index="${index}">
                    <div class="result-title">${title}</div>
                    <div class="result-snippet">${snippet}</div>
                </a>
            `;
        }).join('');

        resultsContainer.innerHTML = html;
        resultsContainer.classList.add('visible');
    }

    /**
     * Highlight matching text
     */
    function highlightText(text, query) {
        const words = query.toLowerCase().split(/\s+/);
        let result = escapeHtml(text);

        for (const word of words) {
            if (word.length < 2) continue;
            const regex = new RegExp('(' + escapeRegex(word) + ')', 'gi');
            result = result.replace(regex, '<mark>$1</mark>');
        }

        return result;
    }

    /**
     * Get a snippet of content around the search term
     */
    function getSnippet(content, query) {
        const words = query.toLowerCase().split(/\s+/);
        const contentLower = content.toLowerCase();

        // Find first occurrence of any search term
        let position = -1;
        for (const word of words) {
            const pos = contentLower.indexOf(word);
            if (pos !== -1 && (position === -1 || pos < position)) {
                position = pos;
            }
        }

        if (position === -1) {
            // No match found, return beginning of content
            return escapeHtml(content.substring(0, 150)) + '...';
        }

        // Extract snippet around the match
        const start = Math.max(0, position - 50);
        const end = Math.min(content.length, position + 150);
        let snippet = content.substring(start, end);

        if (start > 0) snippet = '...' + snippet;
        if (end < content.length) snippet = snippet + '...';

        return highlightText(snippet, query);
    }

    /**
     * Handle keyboard navigation in search results
     */
    function handleKeyNavigation(event) {
        const resultsContainer = document.getElementById('search-results');
        const items = resultsContainer.querySelectorAll('.search-result-item');

        if (items.length === 0) return;

        const currentSelected = resultsContainer.querySelector('.selected');
        let currentIndex = currentSelected ? parseInt(currentSelected.dataset.index) : -1;

        switch (event.key) {
            case 'ArrowDown':
                event.preventDefault();
                currentIndex = Math.min(currentIndex + 1, items.length - 1);
                break;
            case 'ArrowUp':
                event.preventDefault();
                currentIndex = Math.max(currentIndex - 1, 0);
                break;
            case 'Enter':
                if (currentSelected) {
                    event.preventDefault();
                    window.location.href = currentSelected.href;
                }
                return;
            case 'Escape':
                resultsContainer.classList.remove('visible');
                return;
            default:
                return;
        }

        // Update selection
        items.forEach((item, index) => {
            item.classList.toggle('selected', index === currentIndex);
        });
    }

    // ==========================================================================
    // Utility Functions
    // ==========================================================================

    /**
     * Get path to root directory
     */
    function getPathToRoot() {
        // For file:// URLs, we need to find the path relative to the HTML file
        const path = window.location.pathname;

        // Get the directory containing the current HTML file
        const lastSlash = path.lastIndexOf('/');
        const currentDir = path.substring(0, lastSlash + 1);

        // Check if we're in a subdirectory by looking at the HTML filename pattern
        // For now, assume all files are in the root docs directory
        return './';
    }

    /**
     * Debounce function
     */
    function debounce(func, wait) {
        let timeout;
        return function(...args) {
            clearTimeout(timeout);
            timeout = setTimeout(() => func.apply(this, args), wait);
        };
    }

    /**
     * Escape HTML
     */
    function escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    /**
     * Escape regex special characters
     */
    function escapeRegex(string) {
        return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    }

    // ==========================================================================
    // Smooth Scroll for Anchor Links
    // ==========================================================================

    /**
     * Initialize smooth scrolling for anchor links
     */
    function initSmoothScroll() {
        document.querySelectorAll('a[href^="#"]').forEach(anchor => {
            anchor.addEventListener('click', function(e) {
                const targetId = this.getAttribute('href').slice(1);
                const target = document.getElementById(targetId);

                if (target) {
                    e.preventDefault();
                    const headerOffset = 80;
                    const elementPosition = target.getBoundingClientRect().top;
                    const offsetPosition = elementPosition + window.pageYOffset - headerOffset;

                    window.scrollTo({
                        top: offsetPosition,
                        behavior: 'smooth'
                    });

                    // Update URL
                    history.pushState(null, null, '#' + targetId);
                }
            });
        });
    }

    // ==========================================================================
    // Initialize Everything
    // ==========================================================================

    function init() {
        initTheme();
        initMobileSidebar();
        initCollapsibleNav();
        initScrollSpy();
        initSearch();
        initSmoothScroll();
    }

    // Run on DOM ready
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }

})();
