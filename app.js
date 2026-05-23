/**
 * BOOK FINDER - STATIC WEB APPLICATION
 * 
 * NOTE: This application is structured as a classroom-demo simplification.
 * It uses a single, globally shared reading list for all visitors. In a real
 * production deployment, you would integrate Firebase Authentication and write
 * per-user rules to restrict access.
 * 
 * IMPORTANT: To run this application locally, you must serve the files via a 
 * local HTTP server (e.g., "npx serve" or VS Code Live Server). Opening index.html 
 * directly via "file://" in the browser will fail due to security policies restricting 
 * ES Modules and Firebase's fetch calls.
 */

// ==========================================
// (1) FIREBASE INIT + CONFIG
// ==========================================

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import {
  getFirestore,
  collection,
  doc,
  setDoc,
  updateDoc,
  deleteDoc,
  onSnapshot,
  query,
  orderBy,
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

/*
 * FIREBASE WEB CONFIGURATION & SECURITY WARNING
 * 
 * NOTE: The Firebase web configuration (apiKey, projectId, etc.) is public and visible 
 * to anyone loading the page. It is NOT a secret. The true security boundary is defined 
 * by Firestore Security Rules.
 * 
 * The classroom-demo security rules below allow open read and write access on the 
 * "readingList" collection. Before deploying to any real, public production environment, 
 * you MUST lock these rules down (typically by requiring user authentication).
 * 
 * Recommended rules configuration:
 * 
 * rules_version = '2';
 * service cloud.firestore {
 *   match /databases/{db}/documents {
 *     match /readingList/{doc} {
 *       allow read, write: if true; // DEMO ONLY — replace with auth-based rules
 *     }
 *   }
 * }
 */
const firebaseConfig = {
  apiKey: "AIzaSyCRM3lNSFbODg33yovtKEGhtZChajtpUeo",
  authDomain: "bookfinder-539bb.firebaseapp.com",
  projectId: "bookfinder-539bb",
  storageBucket: "bookfinder-539bb.firebasestorage.app",
  messagingSenderId: "96861824758",
  appId: "1:96861824758:web:a0a199f3febc29f6a7eed7"
};

// Initialize Firebase App
const app = initializeApp(firebaseConfig);

// Initialize Firestore
const db = getFirestore(app);


// ==========================================
// (2) FIRESTORE HELPERS
// ==========================================

/**
 * Strips the leading slash from the OpenLibrary key and replaces inner slashes 
 * with underscores to create a clean, deterministic, and idempotent Document ID.
 * Example: "/works/OL45883W" -> "works_OL45883W"
 */
function getDeterministicDocId(olKey) {
  const stripped = olKey.startsWith('/') ? olKey.slice(1) : olKey;
  return stripped.replace(/\//g, '_');
}

/**
 * Saves a book document to Firestore. Clicking "Save" twice will overwrite the 
 * document idempotently (using setDoc with merge: false) on the deterministic ID.
 */
async function saveBook(book) {
  if (!book.olKey) {
    throw new Error("Unable to save book: Missing key from OpenLibrary.");
  }

  const docId = getDeterministicDocId(book.olKey);
  const docRef = doc(db, "readingList", docId);

  const docData = {
    title: book.title,
    authors: book.authors,
    year: book.year,
    coverUrl: book.coverUrl,
    olKey: book.olKey,
    status: 'want_to_read', // default status
    createdAt: serverTimestamp()
  };

  // setDoc with merge: false behaves idempotently, acting as a clean overwrite
  await setDoc(docRef, docData, { merge: false });
}

/**
 * Updates the reading status of a saved book between 'want_to_read' and 'read'.
 */
async function updateStatus(docId, currentStatus) {
  const nextStatus = currentStatus === 'want_to_read' ? 'read' : 'want_to_read';
  const docRef = doc(db, "readingList", docId);

  await updateDoc(docRef, {
    status: nextStatus
  });
}

/**
 * Removes a book document from the reading list.
 */
async function removeBook(docId) {
  const docRef = doc(db, "readingList", docId);
  await deleteDoc(docRef);
}

/**
 * Sets up a live, real-time Firestore listener on the readingList collection,
 * ordered by the creation timestamp in descending order.
 */
function subscribeReadingList(onUpdate, onError) {
  const q = query(collection(db, "readingList"), orderBy("createdAt", "desc"));
  return onSnapshot(q, onUpdate, onError);
}


// ==========================================
// (3) OPENLIBRARY CLIENT
// ==========================================

/**
 * Normalizes an OpenLibrary search result document with fallbacks for safety.
 * Validates dynamic fields before rendering to guarantee type safety.
 */
function normalizeBook(doc) {
  const title = (typeof doc.title === 'string' && doc.title.trim())
    ? doc.title.trim()
    : 'Unknown Title';

  let authors = ['Unknown Author'];
  if (Array.isArray(doc.author_name)) {
    const cleanAuthors = doc.author_name
      .map(a => (typeof a === 'string') ? a.trim() : '')
      .filter(Boolean);
    if (cleanAuthors.length > 0) {
      authors = cleanAuthors;
    }
  }

  let year = null;
  if (typeof doc.first_publish_year === 'number') {
    year = doc.first_publish_year;
  } else if (typeof doc.first_publish_year === 'string') {
    const parsed = parseInt(doc.first_publish_year, 10);
    if (!isNaN(parsed)) {
      year = parsed;
    }
  }

  let coverUrl = null;
  if (doc.cover_i) {
    coverUrl = `https://covers.openlibrary.org/b/id/${doc.cover_i}-M.jpg`;
  }

  const olKey = (typeof doc.key === 'string' && doc.key.trim())
    ? doc.key.trim()
    : '';

  return { title, authors, year, coverUrl, olKey };
}

/**
 * Performs book searching query via OpenLibrary Search API.
 * Employs strict input validations and normalizes matching documents.
 */
async function searchBooks(queryText) {
  const trimmed = queryText.trim();

  if (trimmed.length === 0) {
    throw new Error("Search query cannot be empty.");
  }
  if (trimmed.length > 200) {
    throw new Error("Search query is too long. Please restrict it to under 200 characters.");
  }

  const encodedQuery = encodeURIComponent(trimmed);
  const response = await fetch(`https://openlibrary.org/search.json?q=${encodedQuery}&limit=20`);

  if (!response.ok) {
    throw new Error(`OpenLibrary search failed with HTTP status ${response.status}.`);
  }

  const data = await response.json();

  if (!data || !Array.isArray(data.docs)) {
    return [];
  }

  return data.docs.map(normalizeBook);
}


// ==========================================
// (4) DOM HELPERS
// ==========================================

/**
 * Syntactic DOM helper to create HTML elements dynamically and recursively.
 * Never uses innerHTML with variable content to guarantee complete XSS protection.
 */
function el(tag, props = {}, ...children) {
  const element = document.createElement(tag);

  for (const [key, value] of Object.entries(props)) {
    if (key.startsWith('on') && typeof value === 'function') {
      const eventName = key.slice(2).toLowerCase();
      element.addEventListener(eventName, value);
    } else if (key === 'dataset' && typeof value === 'object') {
      for (const [dataKey, dataValue] of Object.entries(value)) {
        element.dataset[dataKey] = dataValue;
      }
    } else if (key === 'style' && typeof value === 'object') {
      Object.assign(element.style, value);
    } else if (key === 'class') {
      element.className = value;
    } else if (key === 'disabled') {
      element.disabled = !!value;
    } else {
      element.setAttribute(key, value);
    }
  }

  children.flat().forEach(child => {
    if (child === null || child === undefined || child === false) return;
    if (child instanceof Node) {
      element.appendChild(child);
    } else {
      element.appendChild(document.createTextNode(String(child)));
    }
  });

  return element;
}

/**
 * Safely removes all children elements from a parent DOM node.
 */
function clear(node) {
  node.textContent = '';
}


// ==========================================
// (5) RENDERERS
// ==========================================

/**
 * Renders cover image element if coverUrl is present, otherwise falls back
 * to a gorgeous, deterministic color-block placeholder utilizing the first letter.
 */
function renderCover(title, coverUrl) {
  const wrapper = el('div', { class: 'cover-wrapper' });

  if (coverUrl) {
    const img = el('img', {
      class: 'cover-image',
      src: coverUrl,
      alt: `Cover of ${title}`,
      loading: 'lazy'
    });
    // Fall back to color block if cover URL fails to fetch
    img.onerror = () => {
      clear(wrapper);
      wrapper.appendChild(createPlaceholderCover(title));
    };
    wrapper.appendChild(img);
  } else {
    wrapper.appendChild(createPlaceholderCover(title));
  }

  return wrapper;
}

/**
 * Generates a deterministic flat color-block placeholder.
 */
function createPlaceholderCover(title) {
  const firstLetter = title.charAt(0) || '?';

  // Deterministic pastel HSL color based on title characters
  let hash = 0;
  for (let i = 0; i < title.length; i++) {
    hash = title.charCodeAt(i) + ((hash << 5) - hash);
  }
  const h = Math.abs(hash % 360);
  const randomPastel = `hsl(${h}, 50%, 38%)`;

  return el('div', {
    class: 'cover-placeholder',
    style: { backgroundColor: randomPastel }
  },
    el('div', { class: 'placeholder-letter' }, firstLetter),
    el('div', { class: 'placeholder-text' }, 'NO COVER')
  );
}

/**
 * Renders the search results grid.
 */
function renderResults(container, books) {
  clear(container);

  if (books.length === 0) {
    renderEmpty(container, "No results — try another search.");
    return;
  }

  books.forEach(book => {
    const isSaved = state.savedIds.has(getDeterministicDocId(book.olKey));

    // Save button config
    const saveBtn = el('button', {
      type: 'button',
      class: 'btn-primary',
      disabled: isSaved,
      onClick: async (e) => {
        const btn = e.currentTarget;
        btn.disabled = true;
        btn.textContent = "Saving...";

        try {
          await saveBook(book);
          // UI state will sync and disable automatically through the active Firestore listener
        } catch (err) {
          console.error("Failed to save book to Firestore reading list:", err, book);
          btn.disabled = false;
          btn.textContent = "Save";
          const errorContainer = document.getElementById('results-error');
          renderError(errorContainer, "Could not save book to reading list. Please try again.");
        }
      }
    }, isSaved ? "Saved" : "Save");

    const card = el('div', { class: 'book-card' },
      renderCover(book.title, book.coverUrl),
      el('div', { class: 'card-content' },
        el('h3', { class: 'card-title', title: book.title }, book.title),
        el('p', { class: 'card-authors', title: book.authors.join(', ') }, book.authors.join(', ')),
        el('p', { class: 'card-year' }, book.year ? `Published ${book.year}` : 'Year Unknown'),
        el('div', { class: 'card-actions' }, saveBtn)
      )
    );

    container.appendChild(card);
  });
}

/**
 * Renders the reading list grid, incorporating client-side filtering.
 */
function renderReadingList(container, savedBooks) {
  clear(container);

  const filtered = savedBooks.filter(book => {
    if (state.currentFilter === 'all') return true;
    return book.status === state.currentFilter;
  });

  if (filtered.length === 0) {
    if (savedBooks.length === 0) {
      renderEmpty(container, "Your reading list is empty — search for a book and click Save.");
    } else {
      renderEmpty(container, `No books match the filter "${state.currentFilter === 'want_to_read' ? 'Want to Read' : 'Read'}".`);
    }
    return;
  }

  filtered.forEach(book => {
    const docId = getDeterministicDocId(book.olKey);
    const pillText = book.status === 'want_to_read' ? 'Want to Read' : 'Read';

    const toggleBtn = el('button', {
      type: 'button',
      class: 'btn-secondary',
      onClick: async (e) => {
        const btn = e.currentTarget;
        btn.disabled = true;
        try {
          await updateStatus(docId, book.status);
        } catch (err) {
          console.error("Failed to update status in Firestore:", err, { docId, currentStatus: book.status });
          btn.disabled = false;
          const errorContainer = document.getElementById('reading-list-error');
          renderError(errorContainer, "Could not update status. Please try again.");
        }
      }
    }, 'Toggle Status');

    const removeBtn = el('button', {
      type: 'button',
      class: 'btn-danger',
      onClick: async (e) => {
        const btn = e.currentTarget;
        btn.disabled = true;
        try {
          await removeBook(docId);
        } catch (err) {
          console.error("Failed to delete document from Firestore:", err, { docId });
          btn.disabled = false;
          const errorContainer = document.getElementById('reading-list-error');
          renderError(errorContainer, "Could not remove book from reading list. Please try again.");
        }
      }
    }, 'Remove');

    const card = el('div', { class: 'book-card' },
      renderCover(book.title, book.coverUrl),
      el('div', { class: 'card-content' },
        el('span', { class: `status-pill ${book.status}` }, pillText),
        el('h3', { class: 'card-title', title: book.title }, book.title),
        el('p', { class: 'card-authors', title: book.authors.join(', ') }, book.authors.join(', ')),
        el('p', { class: 'card-year' }, book.year ? `Published ${book.year}` : 'Year Unknown'),
        el('div', { class: 'card-actions' }, toggleBtn, removeBtn)
      )
    );

    container.appendChild(card);
  });
}

/**
 * Injects loading spinner and message safely into a section container.
 */
function renderLoading(container, message = "Searching...") {
  clear(container);
  container.appendChild(
    el('div', { class: 'state-container' },
      el('div', { class: 'loading-spinner' }),
      el('p', { class: 'state-title' }, message)
    )
  );
}

/**
 * Injects a visual empty state layout.
 */
function renderEmpty(container, message) {
  clear(container);
  container.appendChild(
    el('div', { class: 'state-container' },
      el('p', { class: 'state-title' }, message)
    )
  );
}

/**
 * Spawns a beautiful, dismissible error banner at the top of the relevant section.
 */
function renderError(container, message) {
  clear(container);
  const banner = el('div', { class: 'error-banner' },
    el('div', { class: 'error-banner-content' },
      el('span', {}, '⚠️'),
      el('span', {}, message)
    ),
    el('button', {
      type: 'button',
      class: 'error-close-btn',
      'aria-label': 'Dismiss error',
      onClick: () => clear(container)
    }, '×')
  );
  container.appendChild(banner);
}


// ==========================================
// (6) STATE
// ==========================================

const state = {
  savedIds: new Set(),
  currentFilter: 'all',  // 'all' | 'want_to_read' | 'read'
  currentResults: [],    // Stores last normal search results 
  readingList: []        // Stores full live array from Firestore Snapshot
};


// ==========================================
// (7) EVENT WIRING
// ==========================================

document.addEventListener('DOMContentLoaded', () => {
  // Grab DOM Nodes
  const searchForm = document.getElementById('search-form');
  const searchInput = document.getElementById('search-input');
  const resultsContainer = document.getElementById('results');
  const resultsErrorContainer = document.getElementById('results-error');
  const readingListContainer = document.getElementById('reading-list');
  const readingListErrorContainer = document.getElementById('reading-list-error');
  const filterChipsContainer = document.querySelector('.filter-chips');
  const filterChips = document.querySelectorAll('.chip');

  // Set initial empty state for results
  renderEmpty(resultsContainer, "Search for a book at the top to start!");

  // Search Form Submit Handler
  searchForm.addEventListener('submit', async (e) => {
    e.preventDefault();

    // Clear previous search errors
    clear(resultsErrorContainer);

    const queryText = searchInput.value;
    const trimmed = queryText.trim();

    // Strict input validations
    if (trimmed.length === 0) {
      renderError(resultsErrorContainer, "Search query cannot be empty. Please type a book title or author.");
      return;
    }
    if (trimmed.length > 200) {
      renderError(resultsErrorContainer, "Search query is too long. Please restrict it to under 200 characters.");
      return;
    }

    renderLoading(resultsContainer, "Searching OpenLibrary...");

    try {
      const results = await searchBooks(trimmed);
      state.currentResults = results;
      renderResults(resultsContainer, results);
    } catch (err) {
      console.error("OpenLibrary search client error occurred:", err, { query: trimmed });
      renderError(resultsErrorContainer, "Search failed. Check your internet connection and try again.");
      clear(resultsContainer);
    }
  });

  // Client-Side Filter Chips click handler
  if (filterChipsContainer) {
    filterChipsContainer.addEventListener('click', (e) => {
      const chip = e.target.closest('.chip');
      if (!chip) return;

      // Update active styling
      filterChips.forEach(c => c.classList.remove('active'));
      chip.classList.add('active');

      // Update state filter and trigger instant re-rendering
      state.currentFilter = chip.dataset.filter;
      renderReadingList(readingListContainer, state.readingList);
    });
  }

  // Subscribe to live Firestore changes
  renderLoading(readingListContainer, "Loading your reading list...");

  const unsubscribe = subscribeReadingList(
    (snapshot) => {
      clear(readingListErrorContainer);

      const booksList = [];
      const newSavedIds = new Set();

      snapshot.forEach(docSnap => {
        const data = docSnap.data();

        // Push normalized document structures
        booksList.push({
          olKey: data.olKey,
          title: data.title,
          authors: data.authors || [],
          year: data.year,
          coverUrl: data.coverUrl,
          status: data.status || 'want_to_read'
        });

        // Re-build idempotent ID Set
        if (data.olKey) {
          newSavedIds.add(getDeterministicDocId(data.olKey));
        }
      });

      // Sync global State
      state.readingList = booksList;
      state.savedIds = newSavedIds;

      // Update both lists dynamically with fresh snapshot context
      renderReadingList(readingListContainer, state.readingList);
      if (state.currentResults.length > 0) {
        renderResults(resultsContainer, state.currentResults);
      }
    },
    (err) => {
      console.error("Firestore onSnapshot subscription failed:", err);
      renderError(readingListErrorContainer, "Failed to connect to the reading list service. Verify database rules.");
      clear(readingListContainer);
    }
  );

  // Clean up snapshot listener if user leaves the page
  window.addEventListener('beforeunload', () => {
    if (typeof unsubscribe === 'function') {
      unsubscribe();
    }
  });
});