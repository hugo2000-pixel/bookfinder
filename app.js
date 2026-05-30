/**
 * BOOK FINDER - STATIC WEB APPLICATION (v2 with Google Auth)
 *
 * Each authenticated user has their own private reading list, isolated by Firestore
 * security rules. Sign-in uses Google OAuth via Firebase Authentication.
 *
 * IMPORTANT: Run via a local HTTP server (Live Server). Opening index.html
 * via file:// will fail because ES Modules require an HTTP origin.
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
  where,
  orderBy,
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import {
  getAuth,
  GoogleAuthProvider,
  signInWithPopup,
  signOut,
  onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";

const firebaseConfig = {
  apiKey: "AIzaSyCRM3lNSFbODg33yovtKEGhtZChajtpUeo",
  authDomain: "bookfinder-539bb.firebaseapp.com",
  projectId: "bookfinder-539bb",
  storageBucket: "bookfinder-539bb.firebasestorage.app",
  messagingSenderId: "96861824758",
  appId: "1:96861824758:web:a0a199f3febc29f6a7eed7"
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);
const auth = getAuth(app);
const googleProvider = new GoogleAuthProvider();


// ==========================================
// (2) AUTH HELPERS
// ==========================================

async function signInWithGoogle() {
  // signInWithPopup opens a Google login window; onAuthStateChanged below will react
  await signInWithPopup(auth, googleProvider);
}

async function signOutUser() {
  await signOut(auth);
}


// ==========================================
// (3) FIRESTORE HELPERS
// ==========================================

function getDeterministicDocId(olKey, userId) {
  // Include userId in the doc ID so different users can save the same book
  // without colliding on a shared deterministic ID.
  const stripped = olKey.startsWith('/') ? olKey.slice(1) : olKey;
  const cleanKey = stripped.replace(/\//g, '_');
  return `${userId}_${cleanKey}`;
}

async function saveBook(book) {
  const user = auth.currentUser;
  if (!user) throw new Error("You must be signed in to save a book.");
  if (!book.olKey) throw new Error("Unable to save book: Missing OpenLibrary key.");

  const docId = getDeterministicDocId(book.olKey, user.uid);
  const docRef = doc(db, "readingList", docId);

  await setDoc(docRef, {
    title: book.title,
    authors: book.authors,
    year: book.year,
    coverUrl: book.coverUrl,
    olKey: book.olKey,
    status: 'want_to_read',
    userId: user.uid, // CRITICAL: required by Firestore security rules
    createdAt: serverTimestamp()
  }, { merge: false });
}

async function updateStatus(docId, currentStatus) {
  const nextStatus = currentStatus === 'want_to_read' ? 'read' : 'want_to_read';
  await updateDoc(doc(db, "readingList", docId), { status: nextStatus });
}

async function removeBook(docId) {
  await deleteDoc(doc(db, "readingList", docId));
}

function subscribeReadingList(userId, onUpdate, onError) {
  // Filter by userId so we only fetch the current user's books.
  // Security rules enforce this server-side too — this is just for efficiency.
  const q = query(
    collection(db, "readingList"),
    where("userId", "==", userId),
    orderBy("createdAt", "desc")
  );
  return onSnapshot(q, onUpdate, onError);
}


// ==========================================
// (4) OPENLIBRARY CLIENT
// ==========================================

function normalizeBook(doc) {
  const title = (typeof doc.title === 'string' && doc.title.trim())
    ? doc.title.trim()
    : 'Unknown Title';

  let authors = ['Unknown Author'];
  if (Array.isArray(doc.author_name)) {
    const cleanAuthors = doc.author_name
      .map(a => (typeof a === 'string') ? a.trim() : '')
      .filter(Boolean);
    if (cleanAuthors.length > 0) authors = cleanAuthors;
  }

  let year = null;
  if (typeof doc.first_publish_year === 'number') {
    year = doc.first_publish_year;
  } else if (typeof doc.first_publish_year === 'string') {
    const parsed = parseInt(doc.first_publish_year, 10);
    if (!isNaN(parsed)) year = parsed;
  }

  const coverUrl = doc.cover_i
    ? `https://covers.openlibrary.org/b/id/${doc.cover_i}-M.jpg`
    : null;

  const olKey = (typeof doc.key === 'string' && doc.key.trim())
    ? doc.key.trim()
    : '';

  return { title, authors, year, coverUrl, olKey };
}

async function searchBooks(queryText) {
  const trimmed = queryText.trim();
  if (trimmed.length === 0) throw new Error("Search query cannot be empty.");
  if (trimmed.length > 200) throw new Error("Search query too long (max 200 chars).");

  const response = await fetch(
    `https://openlibrary.org/search.json?q=${encodeURIComponent(trimmed)}&limit=20`
  );
  if (!response.ok) {
    throw new Error(`OpenLibrary search failed: HTTP ${response.status}`);
  }
  const data = await response.json();
  if (!data || !Array.isArray(data.docs)) return [];
  return data.docs.map(normalizeBook);
}


// ==========================================
// (5) DOM HELPERS
// ==========================================

function el(tag, props = {}, ...children) {
  const element = document.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (key.startsWith('on') && typeof value === 'function') {
      element.addEventListener(key.slice(2).toLowerCase(), value);
    } else if (key === 'dataset' && typeof value === 'object') {
      for (const [dk, dv] of Object.entries(value)) element.dataset[dk] = dv;
    } else if (key === 'style' && typeof value === 'object') {
      Object.assign(element.style, value);
    } else if (key === 'class') {
      element.className = value;
    } else {
      element.setAttribute(key, value);
    }
  }
  children.flat().forEach(child => {
    if (child === null || child === undefined || child === false) return;
    element.appendChild(child instanceof Node ? child : document.createTextNode(String(child)));
  });
  return element;
}

function clear(node) { node.textContent = ''; }


// ==========================================
// (6) RENDERERS
// ==========================================

function renderCover(title, coverUrl) {
  const wrapper = el('div', { class: 'cover-wrapper' });
  if (coverUrl) {
    const img = el('img', {
      class: 'cover-image',
      src: coverUrl,
      alt: `Cover of ${title}`,
      loading: 'lazy'
    });
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

function createPlaceholderCover(title) {
  const firstLetter = title.charAt(0) || '?';
  let hash = 0;
  for (let i = 0; i < title.length; i++) hash = title.charCodeAt(i) + ((hash << 5) - hash);
  const h = Math.abs(hash % 360);
  return el('div', {
    class: 'cover-placeholder',
    style: { backgroundColor: `hsl(${h}, 50%, 38%)` }
  },
    el('div', { class: 'placeholder-letter' }, firstLetter),
    el('div', { class: 'placeholder-text' }, 'NO COVER')
  );
}

function renderResults(container, books) {
  clear(container);
  if (books.length === 0) {
    renderEmpty(container, "No results — try another search.");
    return;
  }

  const user = auth.currentUser;

  books.forEach(book => {
    const isSaved = user
      ? state.savedIds.has(getDeterministicDocId(book.olKey, user.uid))
      : false;

    const saveBtn = el('button', {
      type: 'button',
      class: 'btn-primary',
      disabled: isSaved || !user,
      onClick: async (e) => {
        if (!auth.currentUser) {
          renderError(document.getElementById('results-error'),
            "Please sign in to save books to your reading list.");
          return;
        }
        const btn = e.currentTarget;
        btn.disabled = true;
        btn.textContent = "Saving...";
        try {
          await saveBook(book);
        } catch (err) {
          console.error("Save failed:", err, book);
          btn.disabled = false;
          btn.textContent = "Save";
          renderError(document.getElementById('results-error'),
            "Could not save the book. Please try again.");
        }
      }
    }, !user ? "Sign in to save" : (isSaved ? "Saved" : "Save"));

    container.appendChild(
      el('div', { class: 'book-card' },
        renderCover(book.title, book.coverUrl),
        el('div', { class: 'card-content' },
          el('h3', { class: 'card-title', title: book.title }, book.title),
          el('p', { class: 'card-authors', title: book.authors.join(', ') }, book.authors.join(', ')),
          el('p', { class: 'card-year' }, book.year ? `Published ${book.year}` : 'Year Unknown'),
          el('div', { class: 'card-actions' }, saveBtn)
        )
      )
    );
  });
}

function renderReadingList(container, savedBooks) {
  clear(container);

  if (!auth.currentUser) {
    renderEmpty(container, "Sign in with Google to start building your reading list.");
    return;
  }

  const filtered = savedBooks.filter(book =>
    state.currentFilter === 'all' || book.status === state.currentFilter
  );

  if (filtered.length === 0) {
    if (savedBooks.length === 0) {
      renderEmpty(container, "Your reading list is empty — search for a book and click Save.");
    } else {
      const label = state.currentFilter === 'want_to_read' ? 'Want to Read' : 'Read';
      renderEmpty(container, `No books match the filter "${label}".`);
    }
    return;
  }

  filtered.forEach(book => {
    const docId = getDeterministicDocId(book.olKey, auth.currentUser.uid);
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
          console.error("Status update failed:", err, { docId });
          btn.disabled = false;
          renderError(document.getElementById('reading-list-error'),
            "Could not update status. Please try again.");
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
          console.error("Delete failed:", err, { docId });
          btn.disabled = false;
          renderError(document.getElementById('reading-list-error'),
            "Could not remove the book. Please try again.");
        }
      }
    }, 'Remove');

    container.appendChild(
      el('div', { class: 'book-card' },
        renderCover(book.title, book.coverUrl),
        el('div', { class: 'card-content' },
          el('span', { class: `status-pill ${book.status}` }, pillText),
          el('h3', { class: 'card-title', title: book.title }, book.title),
          el('p', { class: 'card-authors', title: book.authors.join(', ') }, book.authors.join(', ')),
          el('p', { class: 'card-year' }, book.year ? `Published ${book.year}` : 'Year Unknown'),
          el('div', { class: 'card-actions' }, toggleBtn, removeBtn)
        )
      )
    );
  });
}

function renderLoading(container, message = "Searching...") {
  clear(container);
  container.appendChild(
    el('div', { class: 'state-container' },
      el('div', { class: 'loading-spinner' }),
      el('p', { class: 'state-title' }, message)
    )
  );
}

function renderEmpty(container, message) {
  clear(container);
  container.appendChild(
    el('div', { class: 'state-container' },
      el('p', { class: 'state-title' }, message)
    )
  );
}

function renderError(container, message) {
  clear(container);
  container.appendChild(
    el('div', { class: 'error-banner' },
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
    )
  );
}

function renderUserBar(user) {
  const bar = document.getElementById('user-bar');
  if (!bar) return;
  clear(bar);

  if (user) {
    const photo = user.photoURL
      ? el('img', { class: 'user-avatar', src: user.photoURL, alt: user.displayName || 'User avatar' })
      : el('div', { class: 'user-avatar user-avatar-fallback' },
        (user.displayName || user.email || '?').charAt(0).toUpperCase());

    bar.appendChild(
      el('div', { class: 'user-info' },
        photo,
        el('span', { class: 'user-name' }, user.displayName || user.email || 'Signed in'),
        el('button', {
          type: 'button',
          class: 'btn-secondary',
          onClick: async () => {
            try {
              await signOutUser();
            } catch (err) {
              console.error("Sign out failed:", err);
            }
          }
        }, 'Sign out')
      )
    );
  } else {
    bar.appendChild(
      el('button', {
        type: 'button',
        class: 'btn-primary',
        onClick: async () => {
          try {
            await signInWithGoogle();
          } catch (err) {
            console.error("Sign in failed:", err);
            renderError(document.getElementById('results-error'),
              "Sign in failed. Please try again.");
          }
        }
      }, 'Sign in with Google')
    );
  }
}


// ==========================================
// (7) STATE
// ==========================================

const state = {
  savedIds: new Set(),
  currentFilter: 'all',
  currentResults: [],
  readingList: [],
  unsubscribeReadingList: null // holds the active Firestore listener cleanup function
};


// ==========================================
// (8) EVENT WIRING
// ==========================================

document.addEventListener('DOMContentLoaded', () => {
  const searchForm = document.getElementById('search-form');
  const searchInput = document.getElementById('search-input');
  const resultsContainer = document.getElementById('results');
  const resultsErrorContainer = document.getElementById('results-error');
  const readingListContainer = document.getElementById('reading-list');
  const readingListErrorContainer = document.getElementById('reading-list-error');
  const filterChipsContainer = document.querySelector('.filter-chips');
  const filterChips = document.querySelectorAll('.chip');

  renderEmpty(resultsContainer, "Search for a book at the top to start!");

  // --- Search form ---
  searchForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    clear(resultsErrorContainer);

    const trimmed = searchInput.value.trim();
    if (trimmed.length === 0) {
      renderError(resultsErrorContainer, "Please enter a book title or author.");
      return;
    }
    if (trimmed.length > 200) {
      renderError(resultsErrorContainer, "Search too long (max 200 characters).");
      return;
    }

    renderLoading(resultsContainer, "Searching OpenLibrary...");
    try {
      const results = await searchBooks(trimmed);
      state.currentResults = results;
      renderResults(resultsContainer, results);
    } catch (err) {
      console.error("Search failed:", err, { query: trimmed });
      renderError(resultsErrorContainer, "Search failed. Check your connection and try again.");
      clear(resultsContainer);
    }
  });

  // --- Filter chips ---
  if (filterChipsContainer) {
    filterChipsContainer.addEventListener('click', (e) => {
      const chip = e.target.closest('.chip');
      if (!chip) return;
      filterChips.forEach(c => c.classList.remove('active'));
      chip.classList.add('active');
      state.currentFilter = chip.dataset.filter;
      renderReadingList(readingListContainer, state.readingList);
    });
  }

  // --- Auth state listener: drives the entire app lifecycle ---
  onAuthStateChanged(auth, (user) => {
    renderUserBar(user);
    clear(readingListErrorContainer);

    // Tear down any existing Firestore listener before swapping users (or signing out)
    if (state.unsubscribeReadingList) {
      state.unsubscribeReadingList();
      state.unsubscribeReadingList = null;
    }
    state.readingList = [];
    state.savedIds = new Set();

    // Re-render results so Save buttons reflect new auth state
    if (state.currentResults.length > 0) {
      renderResults(resultsContainer, state.currentResults);
    }

    if (!user) {
      renderReadingList(readingListContainer, []);
      return;
    }

    // User is signed in — subscribe to their private reading list
    renderLoading(readingListContainer, "Loading your reading list...");
    state.unsubscribeReadingList = subscribeReadingList(
      user.uid,
      (snapshot) => {
        clear(readingListErrorContainer);
        const booksList = [];
        const newSavedIds = new Set();

        snapshot.forEach(docSnap => {
          const data = docSnap.data();
          booksList.push({
            olKey: data.olKey,
            title: data.title,
            authors: data.authors || [],
            year: data.year,
            coverUrl: data.coverUrl,
            status: data.status || 'want_to_read'
          });
          if (data.olKey) {
            newSavedIds.add(getDeterministicDocId(data.olKey, user.uid));
          }
        });

        state.readingList = booksList;
        state.savedIds = newSavedIds;
        renderReadingList(readingListContainer, state.readingList);
        if (state.currentResults.length > 0) {
          renderResults(resultsContainer, state.currentResults);
        }
      },
      (err) => {
        console.error("Firestore subscription failed:", err);
        renderError(readingListErrorContainer,
          "Failed to load your reading list. Check Firestore rules.");
        clear(readingListContainer);
      }
    );
  });

  // Clean up Firestore listener when leaving the page
  window.addEventListener('beforeunload', () => {
    if (state.unsubscribeReadingList) state.unsubscribeReadingList();
  });
});