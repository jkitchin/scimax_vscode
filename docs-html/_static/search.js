
/**
 * Search functionality for book theme
 * Uses Lunr.js for client-side full-text search
 */
(function() {
    'use strict';

    let searchIndex = null;
    let searchDocuments = {};
    let lunrIndex = null;

    /**
     * Initialize search when DOM is ready
     */
    function initSearch() {
        const searchInput = document.getElementById('search-input');
        const searchResults = document.getElementById('search-results');

        if (!searchInput || !searchResults) {
            return;
        }

        // Load search index
        loadSearchIndex().then(() => {
            // Set up event listeners
            searchInput.addEventListener('input', debounce(handleSearch, 200));
            searchInput.addEventListener('focus', () => {
                if (searchInput.value.length > 0) {
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
            // Get path to root (handle nested pages)
            const pathToRoot = getPathToRoot();
            const response = await fetch(pathToRoot + '_static/search-index.json');
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
        } catch (error) {
            console.error('Failed to load search index:', error);
        }
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

        if (!lunrIndex) {
            return;
        }

        try {
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

    /**
     * Get path to root directory
     */
    function getPathToRoot() {
        const path = window.location.pathname;
        const depth = (path.match(/\//g) || []).length - 1;
        if (depth <= 0) return './';
        return '../'.repeat(depth);
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

    // Initialize when DOM is ready
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initSearch);
    } else {
        initSearch();
    }
})();
