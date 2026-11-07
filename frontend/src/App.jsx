import { useState, useEffect } from 'react'
import './App.css'

// --- FIREBASE IMPORTS ---
import { auth, googleProvider, db } from './firebase'
import { signInWithPopup, signOut, onAuthStateChanged } from 'firebase/auth'
import {
  doc,
  setDoc,
  onSnapshot,
  query,
  collection,
  where,
  updateDoc,
  arrayUnion,
  arrayRemove, // Added for un-settling debts
  deleteDoc,
  increment,
  writeBatch
} from 'firebase/firestore'

// --- ASSETS ---
const GoogleIcon = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
    <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4" />
    <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853" />
    <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05" />
    <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335" />
  </svg>
);

const tripCardEmojis = ['🧳', '🌎', '🏝️', '🏔️', '🏙️', '🗺️', '🚗', '🚆', '🚢', '🏕️', '🌅', '📍'];
const receiptColorOptions = [
  { value: '#182235', label: 'Default' },
  { value: '#1e3a5f', label: 'Blue' },
  { value: '#164e63', label: 'Teal' },
  { value: '#365314', label: 'Green' },
  { value: '#78350f', label: 'Amber' },
  { value: '#701a75', label: 'Purple' },
  { value: '#7f1d1d', label: 'Red' }
];
const MAX_INLINE_IMAGE_CHARS = 260000;
const MAX_TRIP_INLINE_IMAGE_CHARS = 800000;

const inlineImageChars = (value) => (
  typeof value === 'string' && value.includes('data:image/') ? value.length : 0
);

const getTripInlineImageChars = (trip) => (
  inlineImageChars(trip?.tripCover)
  + inlineImageChars(trip?.background)
  + Object.values(trip?.receiptImages || {}).reduce((total, image) => total + inlineImageChars(image), 0)
  + Object.values(trip?.receiptCovers || {}).reduce((total, image) => total + inlineImageChars(image), 0)
);

const ensureInlineImageFits = (trip, previousImage, nextImage) => {
  if (nextImage.length > MAX_INLINE_IMAGE_CHARS) {
    throw new Error('This image is still too large after compression.');
  }
  if (getTripInlineImageChars(trip) - inlineImageChars(previousImage) + nextImage.length > MAX_TRIP_INLINE_IMAGE_CHARS) {
    throw new Error('This trip already has too many saved image bytes.');
  }
};

// Legacy trip covers share a field with the removed AI backgrounds. Keep only
// device-uploaded image data and deliberately ignore remote/generated URLs.
const getUploadedTripCover = (trip) => {
  if (typeof trip.tripCover === 'string' && (trip.tripCover.startsWith('https://') || trip.tripCover.startsWith('data:image/'))) {
    return `url("${trip.tripCover}")`;
  }
  return typeof trip.background === 'string' && trip.background.startsWith('url(data:image/')
    ? trip.background
    : null;
};

const createExpenseId = () => globalThis.crypto?.randomUUID?.()
  || `${Date.now()}-${Math.random().toString(36).slice(2)}`;

const inviteCodeAlphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const createInviteCode = () => {
  const values = new Uint32Array(8);
  if (globalThis.crypto?.getRandomValues) {
    globalThis.crypto.getRandomValues(values);
    return Array.from(values, value => inviteCodeAlphabet[value % inviteCodeAlphabet.length]).join('');
  }
  return Array.from({ length: 8 }, () => inviteCodeAlphabet[Math.floor(Math.random() * inviteCodeAlphabet.length)]).join('');
};

const personKey = (name) => String(name || '').trim().toLocaleLowerCase();

function NoticeRegion({ notice, onDismiss }) {
  if (!notice) return null;

  return (
    <div className="notice-region" aria-live="polite" aria-atomic="true">
      <div className={`notice notice-${notice.tone || 'info'}`} role={notice.tone === 'error' ? 'alert' : 'status'}>
        <span>{notice.message}</span>
        <button type="button" onClick={onDismiss} aria-label="Dismiss message">×</button>
      </div>
    </div>
  );
}

function ConfirmationDialog({ confirmation, onCancel, onConfirm }) {
  if (!confirmation) return null;

  return (
    <div className="dialog-backdrop" role="presentation" onMouseDown={onCancel}>
      <section className="confirmation-dialog" role="dialog" aria-modal="true" aria-labelledby="confirmation-title" onMouseDown={event => event.stopPropagation()}>
        <p className="dialog-eyebrow">Please confirm</p>
        <h2 id="confirmation-title">{confirmation.title}</h2>
        <p>{confirmation.message}</p>
        {confirmation.confirmationPhrase && (
          <label className="confirmation-input">
            Type <strong>{confirmation.confirmationPhrase}</strong> to continue
            <input
              value={confirmation.value || ''}
              onChange={event => confirmation.setValue(event.target.value)}
              autoComplete="off"
              autoFocus
            />
          </label>
        )}
        <div className="dialog-actions">
          <button className="back-btn" type="button" onClick={onCancel}>Cancel</button>
          <button
            className="btn btn-danger"
            type="button"
            onClick={onConfirm}
            disabled={Boolean(confirmation.confirmationPhrase && confirmation.value !== confirmation.confirmationPhrase)}
          >
            {confirmation.confirmLabel || 'Delete'}
          </button>
        </div>
      </section>
    </div>
  );
}

function App() {
  // --- USER STATE ---
  const [user, setUser] = useState(null)

  // --- NAVIGATION STATE ---
  const [view, setView] = useState('login')
  const [activeTripId, setActiveTripId] = useState(null)
  const [activeLocation, setActiveLocation] = useState(null)

  // --- DATA STATE ---
  const [trips, setTrips] = useState([])
  const [newFolderName, setNewFolderName] = useState('')
  const [joinCodeInput, setJoinCodeInput] = useState('');
  const [tripSort, setTripSort] = useState('newest')
  const [isClearingTrips, setIsClearingTrips] = useState(false)
  const [tripEmojiMap, setTripEmojiMap] = useState({})
  const [subcollectionExpenses, setSubcollectionExpenses] = useState([])
  const [isUpgradingExpenses, setIsUpgradingExpenses] = useState(false)

  // --- EDITING STATES ---
  const [isEditingTitle, setIsEditingTitle] = useState(false)
  const [tempTitle, setTempTitle] = useState('')

  // --- RECEIPT BUILDER STATE ---
  const [receiptLoc, setReceiptLoc] = useState('')
  const [receiptPayer, setReceiptPayer] = useState('')
  const [taxMode, setTaxMode] = useState('$')
  const [tipMode, setTipMode] = useState('$')
  const [receiptTax, setReceiptTax] = useState('')
  const [receiptTip, setReceiptTip] = useState('')
  const [currentItems, setCurrentItems] = useState([])

  // Item Inputs
  const [itemName, setItemName] = useState('')
  const [unitPrice, setUnitPrice] = useState('')
  const [quantity, setQuantity] = useState(1)
  const [selectedConsumers, setSelectedConsumers] = useState([])
  const [newParticipantName, setNewParticipantName] = useState('')
  const [isAddingParticipant, setIsAddingParticipant] = useState(false)
  const [isRemovingParticipant, setIsRemovingParticipant] = useState(false)
  const [participantToRemove, setParticipantToRemove] = useState('')

  // EDITING EXPENSE STATE
  const [editingIndex, setEditingIndex] = useState(null)
  const [editingTripExpenseId, setEditingTripExpenseId] = useState(null)
  const [editingLocationBatch, setEditingLocationBatch] = useState(null);

  // Results
  const [results, setResults] = useState([])
  const [hasCalculated, setHasCalculated] = useState(false)
  const [collapsedBreakdowns, setCollapsedBreakdowns] = useState({})
  const [isLoading, setIsLoading] = useState(false)
  const [coverUploads, setCoverUploads] = useState({})
  const [tripCoverUploads, setTripCoverUploads] = useState({})
  const [receiptImageUploads, setReceiptImageUploads] = useState({})
  const [coverEditor, setCoverEditor] = useState(null)
  const [coverCrop, setCoverCrop] = useState({ positionX: 50, positionY: 50, zoom: 1 })
  const [notice, setNotice] = useState(null)
  const [confirmation, setConfirmation] = useState(null)

  const showNotice = (message, tone = 'info') => setNotice({ message, tone })
  const toggleBreakdown = (key) => setCollapsedBreakdowns(current => ({ ...current, [key]: !current[key] }))

  useEffect(() => {
    if (!notice) return undefined;
    const timeout = window.setTimeout(() => setNotice(null), 5000);
    return () => window.clearTimeout(timeout);
  }, [notice]);

  const closeConfirmation = () => setConfirmation(null)
  const confirmAction = async () => {
    const action = confirmation?.onConfirm;
    setConfirmation(null);
    await action?.();
  }

  // ==========================================
  // HELPER: GET DATA
  // ==========================================
  const activeTrip = trips.find(t => t.id === activeTripId)
  const tripExpenses = activeTrip?.expenseStorageVersion === 2
    ? subcollectionExpenses
    : activeTrip?.expenses || [];
  const isTripManager = (trip) => {
    if (!user || !trip) return false;
    if (trip.ownerId) return trip.ownerId === user.uid || trip.admins?.includes(user.uid);
    return trip.members?.[0] === user.uid;
  };
  const manageableTrips = trips.filter(isTripManager);
  const getTimestamp = (value) => value?.toMillis?.() || new Date(value || 0).getTime() || 0;

  const locationExpenses = activeTrip
    ? tripExpenses.filter(e => e.location === activeLocation).sort((a, b) => {
      const dateA = a.createdAt instanceof Object ? a.createdAt.toMillis?.() || new Date(a.createdAt).getTime() : new Date(a.createdAt).getTime();
      const dateB = b.createdAt instanceof Object ? b.createdAt.toMillis?.() || new Date(b.createdAt).getTime() : new Date(b.createdAt).getTime();
      return dateB - dateA;
    })
    : []

  const tripLocations = activeTrip
    ? [...new Set(tripExpenses.map(e => e.location))]
    : []
  const tripTotal = tripExpenses.reduce((sum, expense) => sum + (Number(expense.amount) || 0), 0);
  const receiptTotal = locationExpenses.reduce((sum, expense) => sum + (Number(expense.amount) || 0), 0);
  const getReceiptCount = (trip) => Number.isInteger(trip.receiptCount)
    ? trip.receiptCount
    : new Set((trip.expenses || []).map(expense => expense.location).filter(Boolean)).size;
  const getTripSpent = (trip) => typeof trip.totalSpent === 'number'
    ? trip.totalSpent
    : (trip.expenses || []).reduce((sum, expense) => sum + (Number(expense.amount) || 0), 0);

  // ==========================================
  // CONSUMER CHIP LOGIC
  // ==========================================
  // 1. Extract raw people and filter out duplicates ignoring case
  const rawPeople = [...(activeTrip?.participants || []), ...tripExpenses.flatMap(e => [...e.involved, e.payer])];
  const uniquePeopleMap = new Map();
  rawPeople.forEach(p => {
    const key = personKey(p);
    if (key && !uniquePeopleMap.has(key)) {
      uniquePeopleMap.set(key, String(p).trim()); // Keeps the participant's preferred capitalization
    }
  });

  const existingPeople = Array.from(uniquePeopleMap.values());
  const myName = user?.displayName ? user.displayName.split(' ')[0] : 'Me';

  // Ensure current user is an option
  if (!uniquePeopleMap.has(personKey(myName))) {
    existingPeople.unshift(myName);
  }

  const allAvailablePeople = existingPeople;
  const normalizePerson = (name) => uniquePeopleMap.get(personKey(name)) || String(name || '').trim();
  const normalizePeople = (people) => Array.from(new Map(
    (people || []).map(person => {
      const normalized = normalizePerson(person);
      return [personKey(normalized), normalized];
    }).filter(([key]) => Boolean(key))
  ).values());
  const tripParticipants = normalizePeople(activeTrip?.participants || []);
  const tripSpenderTotals = tripExpenses.reduce((totals, expense) => {
    const consumers = normalizePeople(expense.involved);
    if (consumers.length === 0) return totals;
    const itemSubtotal = Number(expense.originalPrice ?? expense.amount) || 0;
    const sharePerPerson = itemSubtotal / consumers.length;
    consumers.forEach(person => {
      totals[person] = (totals[person] || 0) + sharePerPerson;
    });
    return totals;
  }, Object.fromEntries(tripParticipants.map(person => [person, 0])));
  const rankedSpenders = Object.entries(tripSpenderTotals).sort(([, firstTotal], [, secondTotal]) => firstTotal - secondTotal);
  const lowestSpender = rankedSpenders[0] || ['No payments yet', 0];
  const biggestSpender = rankedSpenders[rankedSpenders.length - 1] || ['No payments yet', 0];
  const tripReceiptTotals = tripExpenses.reduce((totals, expense) => {
    const location = String(expense.location || '').trim() || 'Untitled receipt';
    totals[location] = (totals[location] || 0) + (Number(expense.amount) || 0);
    return totals;
  }, {});
  const rankedReceipts = Object.entries(tripReceiptTotals).sort(([, firstTotal], [, secondTotal]) => firstTotal - secondTotal);
  const lowestReceipt = rankedReceipts[0] || ['No receipts yet', 0];
  const biggestReceipt = rankedReceipts[rankedReceipts.length - 1] || ['No receipts yet', 0];
  const receiptsCoveredByPerson = tripExpenses.reduce((coverage, expense) => {
    const payer = normalizePerson(expense.payer);
    const location = String(expense.location || '').trim();
    if (!payer || !location) return coverage;
    if (!coverage[payer]) coverage[payer] = new Set();
    coverage[payer].add(location);
    return coverage;
  }, {});
  const topReceiptCoverer = Object.entries(receiptsCoveredByPerson)
    .map(([person, locations]) => [person, locations.size])
    .sort(([, firstCount], [, secondCount]) => firstCount - secondCount)
    .at(-1) || ['No one yet', 0];

  const toggleConsumer = (name) => {
    const key = personKey(name);
    if (selectedConsumers.some(person => personKey(person) === key)) {
      setSelectedConsumers(selectedConsumers.filter(person => personKey(person) !== key));
    } else {
      setSelectedConsumers([...selectedConsumers, normalizePerson(name)]);
    }
  }

  // ==========================================
  // 1. AUTHENTICATION LISTENER
  // ==========================================
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (currentUser) => {
      if (currentUser) {
        setUser(currentUser)
        setView('dashboard')
      } else {
        setUser(null)
        setView('login')
        setTrips([])
      }
    })
    return () => unsubscribe()
  }, [])


  // ==========================================
  // 2. DATABASE SYNC (READ/WRITE)
  // ==========================================
  useEffect(() => {
    if (user) {
      const q = query(collection(db, "shared_trips"), where("members", "array-contains", user.uid));

      const unsub = onSnapshot(q, (querySnapshot) => {
        const tripList = [];
        querySnapshot.forEach((doc) => {
          tripList.push({ id: doc.id, ...doc.data() });
        });
        setTrips(tripList);
      }, (error) => {
        console.error("Snapshot Listener failed:", error);
        showNotice('Your trips could not be refreshed. Check your connection and try again.', 'error');
      });
      return () => unsub();
    }
  }, [user]);

  useEffect(() => {
    if (!activeTripId || activeTrip?.expenseStorageVersion !== 2) {
      setSubcollectionExpenses([]);
      return undefined;
    }

    return onSnapshot(collection(db, 'shared_trips', activeTripId, 'expenses'), (snapshot) => {
      setSubcollectionExpenses(snapshot.docs.map(expenseDoc => ({ id: expenseDoc.id, ...expenseDoc.data() })));
    }, (error) => {
      console.error('Expense listener failed:', error);
      showNotice('Receipt items could not be refreshed. Please try again.', 'error');
    });
  }, [activeTripId, activeTrip?.expenseStorageVersion]);

  useEffect(() => {
    setTripEmojiMap((currentMap) => {
      const nextMap = {};
      trips.forEach((trip) => {
        nextMap[trip.id] = currentMap[trip.id] || tripCardEmojis[Math.floor(Math.random() * tripCardEmojis.length)];
      });
      return nextMap;
    });
  }, [trips]);

  useEffect(() => {
    if (!user) return;
    trips
      .filter(trip => !trip.ownerId && trip.members?.[0] === user.uid)
      .forEach(async (trip) => {
        try {
          await updateDoc(doc(db, "shared_trips", trip.id), {
            ownerId: user.uid,
            admins: [user.uid]
          });
        } catch (err) {
          console.warn("Could not claim legacy trip ownership:", trip.id, err);
        }
      });
  }, [trips, user]);

  const updateTripInCloud = async (tripId, updatedData) => {
    if (!user) return false;
    try {
      const tripRef = doc(db, "shared_trips", tripId);
      await updateDoc(tripRef, { ...updatedData, lastUpdated: new Date() });
      return true;
    } catch (e) {
      console.error("Error updating trip:", e);
      showNotice('We could not save that change. Please check your connection and try again.', 'error');
      return false;
    }
  };

  // ==========================================
  // AUTH ACTIONS
  // ==========================================
  const handleGoogleLogin = async () => {
    try {
      await signInWithPopup(auth, googleProvider)
    } catch (error) {
      console.error(error)
      showNotice('Google sign-in did not finish. Please try again.', 'error')
    }
  }

  const handleLogout = async () => {
    await signOut(auth)
  }

  // ==========================================
  // NAVIGATION ACTIONS
  // ==========================================
  const goHome = () => {
    setView('dashboard')
    setActiveTripId(null)
    setActiveLocation(null)
    setEditingLocationBatch(null)
  }

  const openTrip = (id) => {
    setActiveTripId(id)
    setView('trip_view')
    setResults([])
    setHasCalculated(false)
  }

  const openLocationTab = (location) => {
    setActiveLocation(location)
    setView('receipt_detail')
  }

  const openReceiptBuilder = () => {
    setReceiptLoc('')
    setReceiptPayer('')
    setReceiptTax('')
    setReceiptTip('')
    setCurrentItems([])
    setQuantity(1)
    setTaxMode('$')
    setTipMode('$')
    setEditingIndex(null)
    setEditingTripExpenseId(null)
    setEditingLocationBatch(null)
    setSelectedConsumers([])
    setView('receipt_editor')
  }

  // ==========================================
  // BATCH EDIT, PHOTO RESIZE, PDF
  // ==========================================
  const loadReceiptBatch = (location) => {
    const batchExpenses = tripExpenses.filter(e => e.location === location);
    if (batchExpenses.length === 0) return;

    const commonPayer = normalizePerson(batchExpenses[0].payer);
    const totalTax = batchExpenses.reduce((sum, e) => sum + e.taxShare, 0);
    const totalTip = batchExpenses.reduce((sum, e) => sum + e.tipShare, 0);

    const builderItems = batchExpenses.map(e => ({
      name: e.rawName || e.item,
      qty: e.rawQty || 1,
      unitPrice: e.rawUnitPrice || (e.originalPrice / (e.rawQty || 1)),
      totalPrice: e.originalPrice,
      consumers: normalizePeople(e.involved)
    }));

    setReceiptLoc(location);
    setReceiptPayer(commonPayer);
    setReceiptTax(totalTax.toFixed(2));
    setReceiptTip(totalTip.toFixed(2));
    setCurrentItems(builderItems);

    setTaxMode('$');
    setTipMode('$');

    setEditingLocationBatch(location);
    setView('receipt_editor');
  };

  const prepareReceiptImage = (file, maxWidth = 800) => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onerror = () => reject(new Error('The image could not be read.'));
      reader.readAsDataURL(file);
      reader.onload = (event) => {
        const img = new Image();
        img.src = event.target.result;
        img.onload = () => {
          const canvas = document.createElement('canvas');
          let width = img.width;
          let height = img.height;

          if (width > maxWidth) {
            height *= maxWidth / width;
            width = maxWidth;
          }

          canvas.width = width;
          canvas.height = height;
          const ctx = canvas.getContext('2d');
          ctx.drawImage(img, 0, 0, width, height);
          canvas.toBlob((blob) => {
            if (blob) {
              const compressedReader = new FileReader();
              compressedReader.onerror = () => reject(new Error('The image could not be prepared.'));
              compressedReader.onload = () => resolve(compressedReader.result);
              compressedReader.readAsDataURL(blob);
            }
            else reject(new Error('The image could not be prepared.'));
          }, 'image/jpeg', 0.7);
        };
        img.onerror = () => reject(new Error('The image could not be decoded.'));
      };
    });
  };

  const handleReceiptImageUpload = async (e, location) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    if (!activeTrip || receiptImageUploads[location]) return;
    if (!file.type.startsWith('image/')) return showNotice('Choose an image file for this receipt.', 'error');
    if (file.size > 10000000) return showNotice('Choose an image smaller than 10 MB.', 'error');

    setReceiptImageUploads(current => ({ ...current, [location]: true }));
    try {
      const imageDataUrl = await prepareReceiptImage(file);
      ensureInlineImageFits(activeTrip, activeTrip.receiptImages?.[location], imageDataUrl);
      const updatedPaths = { ...(activeTrip.receiptImagePaths || {}) };
      delete updatedPaths[location];
      const saved = await updateTripInCloud(activeTripId, {
        receiptImages: { ...(activeTrip.receiptImages || {}), [location]: imageDataUrl },
        receiptImagePaths: updatedPaths
      });
      if (saved) showNotice('Receipt photo uploaded.', 'success');
    } catch (err) {
      console.error("Image upload error:", err);
      showNotice('We could not save that photo. Choose a smaller image or remove another saved photo from this trip.', 'error');
    } finally {
      setReceiptImageUploads(current => ({ ...current, [location]: false }));
    }
  };

  const removeReceiptImage = async (location) => {
    if (!activeTrip) return;
    setConfirmation({
      title: 'Remove receipt photo?',
      message: 'The photo will be removed from this receipt. This cannot be undone.',
      confirmLabel: 'Remove photo',
      onConfirm: async () => {
        const updatedImages = { ...(activeTrip.receiptImages || {}) };
        const updatedPaths = { ...(activeTrip.receiptImagePaths || {}) };
        delete updatedImages[location];
        delete updatedPaths[location];
        try {
          await updateDoc(doc(db, 'shared_trips', activeTripId), {
            receiptImages: updatedImages,
            receiptImagePaths: updatedPaths,
            lastUpdated: new Date()
          });
          showNotice('Receipt photo removed.', 'success');
        } catch (err) {
          console.error('Receipt photo removal failed:', err);
          showNotice('We could not remove that photo. Please try again.', 'error');
        }
      }
    });
  };

  const updateReceiptColor = async (location, color) => {
    if (!activeTrip) return;
    const updatedColors = { ...(activeTrip.receiptColors || {}) };
    if (color === receiptColorOptions[0].value) {
      delete updatedColors[location];
    } else {
      updatedColors[location] = color;
    }
    await updateTripInCloud(activeTripId, { receiptColors: updatedColors });
  };

  const handleTripCoverUpload = async (event, trip) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    if (!file.type.startsWith('image/')) return showNotice('Choose an image file to use as a cover.', 'error');
    if (file.size > 10 * 1024 * 1024) return showNotice('Choose an image smaller than 10 MB.', 'error');

    setTripCoverUploads(current => ({ ...current, [trip.id]: true }));
    try {
      const coverDataUrl = await prepareReceiptImage(file);
      ensureInlineImageFits(trip, trip.tripCover, coverDataUrl);
      await updateDoc(doc(db, 'shared_trips', trip.id), {
        tripCover: coverDataUrl,
        tripCoverPath: '',
        lastUpdated: new Date()
      });
      showNotice('Trip cover updated.', 'success');
    } catch (err) {
      console.error('Trip cover upload failed:', err);
      showNotice('We could not save that cover. Choose a smaller image or remove another saved photo from this trip.', 'error');
    } finally {
      setTripCoverUploads(current => ({ ...current, [trip.id]: false }));
    }
  };

  const removeTripCover = (event, trip) => {
    event.stopPropagation();
    setConfirmation({
      title: 'Remove trip cover?',
      message: 'The trip will return to its standard card appearance.',
      confirmLabel: 'Remove cover',
      onConfirm: async () => {
        try {
          await updateDoc(doc(db, 'shared_trips', trip.id), {
            tripCover: '',
            tripCoverPath: '',
            background: null,
            lastUpdated: new Date()
          });
          showNotice('Trip cover removed.', 'success');
        } catch (error) {
          console.error('Trip cover removal failed:', error);
          showNotice('We could not remove that trip cover. Please try again.', 'error');
        }
      }
    });
  };

  const closeCoverEditor = () => {
    if (coverEditor?.previewUrl) URL.revokeObjectURL(coverEditor.previewUrl);
    setCoverEditor(null);
  };

  const openReceiptCoverEditor = (event, location) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    if (!file.type.startsWith('image/')) return showNotice('Choose an image file to use as a cover.', 'error');
    if (file.size > 10 * 1024 * 1024) return showNotice('Choose an image smaller than 10 MB.', 'error');

    const savedCrop = activeTrip?.receiptCoverSettings?.[location];
    setCoverCrop({
      positionX: savedCrop?.positionX ?? 50,
      positionY: savedCrop?.positionY ?? 50,
      zoom: savedCrop?.zoom ?? 1
    });
    setCoverEditor({ file, location, previewUrl: URL.createObjectURL(file) });
  };

  const uploadReceiptCover = async () => {
    if (!coverEditor || !activeTrip) return;
    const { file, location } = coverEditor;

    setCoverUploads(current => ({ ...current, [location]: true }));
    try {
      const coverDataUrl = await prepareReceiptImage(file);
      ensureInlineImageFits(activeTrip, activeTrip.receiptCovers?.[location], coverDataUrl);
      const updatedPaths = { ...(activeTrip.receiptCoverPaths || {}) };
      delete updatedPaths[location];
      await updateDoc(doc(db, 'shared_trips', activeTripId), {
        receiptCovers: { ...(activeTrip.receiptCovers || {}), [location]: coverDataUrl },
        receiptCoverPaths: updatedPaths,
        receiptCoverSettings: { ...(activeTrip.receiptCoverSettings || {}), [location]: coverCrop },
        lastUpdated: new Date()
      });
      closeCoverEditor();
      showNotice('Receipt cover updated.', 'success');
    } catch (err) {
      console.error('Receipt cover upload failed:', err);
      showNotice('We could not save that cover. Choose a smaller image or remove another saved photo from this trip.', 'error');
    } finally {
      setCoverUploads(current => ({ ...current, [location]: false }));
    }
  };

  const removeReceiptCover = (location) => {
    if (!activeTrip?.receiptCovers?.[location]) return;
    setConfirmation({
      title: 'Remove receipt cover?',
      message: 'This removes the chosen card cover. The original receipt photo, if present, will be used instead.',
      confirmLabel: 'Remove cover',
      onConfirm: async () => {
        const updatedCovers = { ...(activeTrip.receiptCovers || {}) };
        const updatedPaths = { ...(activeTrip.receiptCoverPaths || {}) };
        const updatedSettings = { ...(activeTrip.receiptCoverSettings || {}) };
        delete updatedCovers[location];
        delete updatedPaths[location];
        delete updatedSettings[location];
        try {
          await updateDoc(doc(db, 'shared_trips', activeTripId), {
            receiptCovers: updatedCovers,
            receiptCoverPaths: updatedPaths,
            receiptCoverSettings: updatedSettings,
            lastUpdated: new Date()
          });
          showNotice('Receipt cover removed.', 'success');
        } catch (error) {
          console.error('Receipt cover removal failed:', error);
          showNotice('We could not remove that receipt cover. Please try again.', 'error');
        }
      }
    });
  };

  const printReceipt = () => window.print();

  // DATA ACTIONS
  const upgradeTripExpenses = async () => {
    if (!activeTrip || activeTrip.expenseStorageVersion === 2 || !isTripManager(activeTrip) || isUpgradingExpenses) return;
    const legacyExpenses = activeTrip.expenses || [];
    if (legacyExpenses.length > 450) {
      showNotice('This trip has too many items for a one-step upgrade. Please contact the app owner for a guided migration.', 'error');
      return;
    }

    setIsUpgradingExpenses(true);
    try {
      const batch = writeBatch(db);
      legacyExpenses.forEach((expense) => {
        const expenseId = String(expense.id || createExpenseId());
        batch.set(doc(db, 'shared_trips', activeTripId, 'expenses', expenseId), { ...expense, id: expenseId });
      });
      batch.update(doc(db, 'shared_trips', activeTripId), {
        expenses: [],
        expenseStorageVersion: 2,
        expenseCount: legacyExpenses.length,
        receiptCount: new Set(legacyExpenses.map(expense => expense.location).filter(Boolean)).size,
        totalSpent: legacyExpenses.reduce((sum, expense) => sum + (Number(expense.amount) || 0), 0),
        lastUpdated: new Date()
      });
      await batch.commit();
      showNotice('This trip is ready for safer shared editing.', 'success');
    } catch (error) {
      console.error('Trip expense upgrade failed:', error);
      showNotice('We could not upgrade this trip. Your existing receipts are unchanged.', 'error');
    } finally {
      setIsUpgradingExpenses(false);
    }
  };

  const createFolder = async () => {
    if (!newFolderName.trim()) return;

    const generatedCode = createInviteCode();
    const now = new Date();

    const newTrip = {
      name: newFolderName,
      expenses: [],
      expenseStorageVersion: 2,
      expenseCount: 0,
      receiptCount: 0,
      totalSpent: 0,
      joinCode: generatedCode,
      ownerId: user.uid,
      admins: [user.uid],
      members: [user.uid],
      participants: [user.displayName?.split(' ')[0] || 'Me'],
      settledDebts: [],
      createdAt: now,
      lastUpdated: now
    };

    try {
      await setDoc(doc(db, "shared_trips", generatedCode), newTrip);
      setNewFolderName('');
      showNotice(`“${newTrip.name}” is ready to share.`, 'success');
    } catch (e) {
      console.error("Error creating shared trip: ", e);
      showNotice('We could not create that trip. Please try again.', 'error');
    }
  };

  const handleJoinTrip = async () => {
    if (!joinCodeInput.trim()) return;
    const formattedCode = joinCodeInput.trim().toUpperCase();
    try {
      const tripRef = doc(db, "shared_trips", formattedCode);
      await updateDoc(tripRef, {
        members: arrayUnion(user.uid)
      });
      setJoinCodeInput('');
      showNotice('You joined the trip.', 'success');
    } catch (e) {
      console.error("Join Error:", e);
      showNotice('We could not find that trip. Check the invite code and try again.', 'error');
    }
  };

  const leaveTrip = () => {
    if (!activeTrip || isTripManager(activeTrip)) return;
    setConfirmation({
      title: `Leave “${activeTrip.name}”?`,
      message: 'You will lose access to this trip and can only return with its invite code.',
      confirmLabel: 'Leave trip',
      onConfirm: async () => {
        try {
          await updateDoc(doc(db, 'shared_trips', activeTripId), {
            members: arrayRemove(user.uid)
          });
          goHome();
          showNotice('You left the trip.', 'success');
        } catch (error) {
          console.error('Could not leave trip:', error);
          showNotice('We could not leave this trip. Please try again.', 'error');
        }
      }
    });
  };

  const deleteFolder = async (e, id) => {
    e.stopPropagation();
    const tripToDelete = trips.find(trip => trip.id === id);
    if (!isTripManager(tripToDelete)) return showNotice('Only the trip owner or an admin can delete this trip.', 'error');

    setConfirmation({
      title: `Delete “${tripToDelete?.name || 'this trip'}”?`,
      message: 'This removes the trip and its shared data for everyone who has access.',
      confirmLabel: 'Delete trip',
      onConfirm: async () => {
        try {
          await deleteDoc(doc(db, "shared_trips", id));
          showNotice('Trip deleted.', 'success');
        } catch (err) {
          console.error("Error deleting trip: ", err);
          showNotice('We could not delete that trip. Please try again.', 'error');
        }
      }
    });
  };

  const clearAllTrips = async () => {
    if (!user || manageableTrips.length === 0 || isClearingTrips) return;
    const tripCount = manageableTrips.length;
    const confirmationPhrase = `CLEAR ${tripCount}`;
    const confirmationState = { value: '' };
    setConfirmation({
      title: `Delete ${tripCount} trip${tripCount === 1 ? '' : 's'}?`,
      message: 'This permanently removes every trip you own or administer for everyone who has access.',
      confirmationPhrase,
      ...confirmationState,
      setValue: value => setConfirmation(current => ({ ...current, value })),
      confirmLabel: 'Delete all trips',
      onConfirm: async () => {
        setIsClearingTrips(true);
        try {
          const batchSize = 450;
          for (let i = 0; i < manageableTrips.length; i += batchSize) {
            const batch = writeBatch(db);
            manageableTrips.slice(i, i + batchSize).forEach((trip) => {
              batch.delete(doc(db, "shared_trips", trip.id));
            });
            await batch.commit();
          }
          showNotice('Your managed trips were deleted.', 'success');
        } catch (err) {
          console.error("Error clearing trips: ", err);
          showNotice('We could not clear every trip. Please refresh and try again.', 'error');
        } finally {
          setIsClearingTrips(false);
        }
      }
    });
  };

  const deleteExpense = (expenseId) => {
    const expense = tripExpenses.find(item => item.id === expenseId);
    if (!expense) return;
    setConfirmation({
      title: 'Remove this item?',
      message: `“${expense.item}” will be removed from ${expense.location}.`,
      confirmLabel: 'Remove item',
      onConfirm: async () => {
        try {
          if (activeTrip.expenseStorageVersion === 2) {
            const batch = writeBatch(db);
            batch.delete(doc(db, 'shared_trips', activeTripId, 'expenses', String(expenseId)));
            const remainingExpenses = tripExpenses.filter(item => item.id !== expenseId);
            batch.update(doc(db, 'shared_trips', activeTripId), {
              expenseCount: increment(-1),
              receiptCount: new Set(remainingExpenses.map(item => item.location).filter(Boolean)).size,
              totalSpent: remainingExpenses.reduce((sum, item) => sum + (Number(item.amount) || 0), 0),
              lastUpdated: new Date()
            });
            await batch.commit();
            setResults([]);
            setHasCalculated(false);
            showNotice('Receipt item removed.', 'success');
            return;
          }
          const updatedExpenses = tripExpenses.filter(item => item.id !== expenseId);
          const saved = await updateTripInCloud(activeTripId, {
            expenses: updatedExpenses,
            receiptCount: new Set(updatedExpenses.map(item => item.location).filter(Boolean)).size,
            totalSpent: updatedExpenses.reduce((sum, item) => sum + (Number(item.amount) || 0), 0)
          });
          if (saved) {
            setResults([]);
            setHasCalculated(false);
            showNotice('Receipt item removed.', 'success');
          }
        } catch (error) {
          console.error('Expense removal failed:', error);
          showNotice('We could not remove that item. Please try again.', 'error');
        }
      }
    });
  };

  const addTripParticipant = async (event) => {
    event.preventDefault();
    if (!activeTrip || !newParticipantName.trim()) return;
    const name = newParticipantName.trim().split(/\s+/).map(word =>
      word.charAt(0).toUpperCase() + word.slice(1).toLowerCase()
    ).join(' ');
    if ((activeTrip.participants || []).some(person => person.toLowerCase() === name.toLowerCase())) {
      setNewParticipantName('');
      setIsAddingParticipant(false);
      return;
    }
    await updateTripInCloud(activeTripId, { participants: [...(activeTrip.participants || []), name] });
    setNewParticipantName('');
    setIsAddingParticipant(false);
  };

  const removeTripParticipant = async (name) => {
    if (!activeTrip) return;
    const targetKey = personKey(name);
    const isUsed = tripExpenses.some(expense => personKey(expense.payer) === targetKey || expense.involved.some(person => personKey(person) === targetKey));
    if (isUsed) return showNotice(`${name} is included on a receipt and cannot be removed.`, 'error');
    await updateTripInCloud(activeTripId, { participants: (activeTrip.participants || []).filter(person => personKey(person) !== targetKey) });
    setParticipantToRemove('');
    setIsRemovingParticipant(false);
  };

  const handleSaveTripName = async () => {
    if (!tempTitle.trim()) return setIsEditingTitle(false);
    await updateTripInCloud(activeTripId, { name: tempTitle });
    setIsEditingTitle(false);
  };

  // --- SETTLEMENT MARKER ---
  const toggleSettlement = async (settlement) => {
    if (!activeTrip || !activeTripId) return;

    const currentSettled = activeTrip.settledDebts || [];
    const settledKey = currentSettled.includes(settlement.id)
      ? settlement.id
      : currentSettled.includes(settlement.legacyLine)
        ? settlement.legacyLine
        : null;
    const isSettled = Boolean(settledKey);

    const tripRef = doc(db, "shared_trips", activeTripId);

    try {
      await updateDoc(tripRef, {
        settledDebts: isSettled ? arrayRemove(settledKey) : arrayUnion(settlement.id)
      });
      showNotice(isSettled ? 'Marked as unpaid.' : 'Marked as paid.', 'success');
    } catch (e) {
      console.error("Error updating settlement status:", e);
      showNotice('We could not update that settlement. Please try again.', 'error');
    }
  };

  // --- EDIT SAVED EXPENSE ---
  const editSavedExpense = (expense) => {
    setEditingTripExpenseId(expense.id)
    setReceiptLoc(expense.location)
    setReceiptPayer(normalizePerson(expense.payer))

    const name = expense.rawName || expense.item.replace(/^\d+x\s/, '')
    const qty = expense.rawQty || 1
    const price = expense.rawUnitPrice || expense.originalPrice / qty

    const reconstructedItem = {
      name: name,
      qty: qty,
      unitPrice: price,
      totalPrice: expense.originalPrice,
      consumers: normalizePeople(expense.involved)
    }
    setCurrentItems([reconstructedItem])

    setReceiptTax(expense.taxShare.toFixed(2))
    setReceiptTip(expense.tipShare.toFixed(2))
    setTaxMode('$')
    setTipMode('$')
    setEditingLocationBatch(null);
    setView('receipt_editor')
  }

  // --- CALCULATION ---
  const calculateTripSettlement = async () => {
    if (!activeTrip || tripExpenses.length === 0) return;
    setIsLoading(true);

    try {
      // Get Firebase ID token for server-side verification
      const idToken = user && (await user.getIdToken());

      const headers = { 'Content-Type': 'application/json' };
      if (idToken) headers['Authorization'] = `Bearer ${idToken}`;

      const response = await fetch('/api/calculate', {
        method: 'POST',
        headers,
        body: JSON.stringify(tripExpenses.map(expense => ({
          ...expense,
          payer: normalizePerson(expense.payer),
          involved: normalizePeople(expense.involved)
        }))),
      });

      if (!response.ok) {
        const err = await response.json().catch(() => ({}));
        throw new Error(err.error || 'Network response was not ok');
      }

      const settlementPlan = await response.json();
      setResults(Array.isArray(settlementPlan) ? settlementPlan : settlementPlan.data || []);
      setHasCalculated(true);
    } catch (error) {
      console.error("Error fetching settlement:", error);
      showNotice(error.message || 'We could not calculate settlements. Please try again.', 'error');
    } finally {
      setIsLoading(false);
    }
  }

  // --- BUILDER ACTIONS ---
  const handleAddOrUpdateItem = () => {
    const price = Number(unitPrice)
    const itemQuantity = Number(quantity)
    if (!itemName.trim() || !Number.isFinite(price) || price <= 0 || !Number.isFinite(itemQuantity) || itemQuantity <= 0 || selectedConsumers.length === 0) {
      return showNotice('Enter an item, a positive price and quantity, then select who shared it.', 'error')
    }
    const qty = itemQuantity
    const totalLineCost = price * qty
    const newItem = {
      name: itemName,
      qty: qty,
      unitPrice: price,
      totalPrice: totalLineCost,
      consumers: selectedConsumers
    }
    if (editingIndex !== null) {
      const updated = [...currentItems]
      updated[editingIndex] = newItem
      setCurrentItems(updated)
      setEditingIndex(null)
    } else {
      setCurrentItems([...currentItems, newItem])
    }
    setItemName('')
    setUnitPrice('')
    setQuantity(1)
    setSelectedConsumers([])
  }

  const startEditingDraftItem = (index) => {
    const item = currentItems[index]
    setItemName(item.name)
    setUnitPrice(item.unitPrice)
    setQuantity(item.qty)
    setSelectedConsumers(item.consumers)
    setEditingIndex(index)
  }

  const saveReceiptToTrip = async () => {
    if (!receiptLoc.trim() || !receiptPayer.trim()) return showNotice('Add a receipt name and choose who paid.', 'error');
    if (currentItems.length === 0) return showNotice('Add at least one item before saving this receipt.', 'error');

    const subtotal = currentItems.reduce((sum, item) => sum + item.totalPrice, 0);
    let taxTotal = parseFloat(receiptTax) || 0;
    let tipTotal = parseFloat(receiptTip) || 0;

    if (taxMode === '%') taxTotal = subtotal * (taxTotal / 100);
    if (tipMode === '%') tipTotal = subtotal * (tipTotal / 100);

    const taxRate = subtotal > 0 ? (taxTotal / subtotal) : 0;
    const tipRate = subtotal > 0 ? (tipTotal / subtotal) : 0;

    const newExpenses = currentItems.map(item => {
      const itemTax = item.totalPrice * taxRate;
      const itemTip = item.totalPrice * tipRate;
      return {
        id: createExpenseId(),
        item: `${item.qty}x ${item.name}`,
        location: receiptLoc,
        payer: normalizePerson(receiptPayer),
        amount: item.totalPrice + itemTax + itemTip,
        involved: normalizePeople(item.consumers),
        rawName: item.name,
        rawQty: item.qty,
        rawUnitPrice: item.unitPrice,
        originalPrice: item.totalPrice,
        taxShare: itemTax,
        tipShare: itemTip,
        createdAt: new Date()
      };
    });

    try {
      const tripRef = doc(db, "shared_trips", activeTripId);
      let finalExpensesList = tripExpenses;

      if (editingLocationBatch) {
        finalExpensesList = finalExpensesList.filter(e => e.location !== editingLocationBatch);
      } else if (editingTripExpenseId) {
        finalExpensesList = finalExpensesList.filter(e => e.id !== editingTripExpenseId);
      }

      if (activeTrip.expenseStorageVersion === 2) {
        const batch = writeBatch(db);
        const replacedExpenses = editingLocationBatch
          ? tripExpenses.filter(expense => expense.location === editingLocationBatch)
          : editingTripExpenseId
            ? tripExpenses.filter(expense => expense.id === editingTripExpenseId)
            : [];

        replacedExpenses.forEach((expense) => {
          batch.delete(doc(db, 'shared_trips', activeTripId, 'expenses', String(expense.id)));
        });
        newExpenses.forEach((expense) => {
          batch.set(doc(db, 'shared_trips', activeTripId, 'expenses', expense.id), expense);
        });
        batch.update(tripRef, {
          expenseCount: increment(newExpenses.length - replacedExpenses.length),
          receiptCount: new Set([...finalExpensesList, ...newExpenses].map(expense => expense.location).filter(Boolean)).size,
          totalSpent: [...finalExpensesList, ...newExpenses].reduce((sum, expense) => sum + (Number(expense.amount) || 0), 0),
          lastUpdated: new Date()
        });
        await batch.commit();
      } else {
        await updateDoc(tripRef, {
          expenses: [...finalExpensesList, ...newExpenses],
          receiptCount: new Set([...finalExpensesList, ...newExpenses].map(expense => expense.location).filter(Boolean)).size,
          totalSpent: [...finalExpensesList, ...newExpenses].reduce((sum, expense) => sum + (Number(expense.amount) || 0), 0),
          lastUpdated: new Date()
        });
      }

      setActiveLocation(receiptLoc);
      setView('receipt_detail');
      setResults([]);
      setHasCalculated(false);
      setEditingTripExpenseId(null);
      setEditingLocationBatch(null);
      showNotice(editingTripExpenseId || editingLocationBatch ? 'Receipt changes saved.' : 'Receipt saved.', 'success');
    } catch (err) {
      console.error("Save failed:", err);
      showNotice('We could not save that receipt. Please try again.', 'error');
    }
  };

  const getBreakdown = (expensesList) => {
    const breakdown = {}
    expensesList.forEach(exp => {
      const involvedPeople = normalizePeople(exp.involved)
      const numPeople = involvedPeople.length
      if (numPeople === 0) return
      const splitPrice = exp.originalPrice / numPeople
      const splitTax = exp.taxShare / numPeople
      const splitTip = exp.tipShare / numPeople
      const splitTotal = exp.amount / numPeople

      let displayName = exp.item;
      if (exp.rawQty && exp.rawName) {
        // Divide the total quantity by the number of people splitting it
        const splitQty = exp.rawQty / numPeople;

        // Format to avoid long decimals (e.g., 3 sodas / 2 people = 1.5x)
        const formattedQty = Number.isInteger(splitQty) ? splitQty : parseFloat(splitQty.toFixed(2));
        displayName = `${formattedQty}x ${exp.rawName}`;
      } else {
        // Fallback for older legacy expenses before rawQty was added
        const strippedName = exp.item.replace(/^\d+x\s/, '');
        displayName = `(Split) ${strippedName}`;
      }

      involvedPeople.forEach(person => {
        if (!breakdown[person]) {
          breakdown[person] = { items: [], subtotal: 0, tax: 0, tip: 0, grandTotal: 0 }
        }
        breakdown[person].items.push({
          name: displayName, // Now uses the dynamically calculated name
          location: exp.location,
          cost: splitPrice
        })
        breakdown[person].subtotal += splitPrice
        breakdown[person].tax += splitTax
        breakdown[person].tip += splitTip
        breakdown[person].grandTotal += splitTotal
      })
    })
    return breakdown
  }

  // ##########################################
  // MAIN RENDER
  // ##########################################

  if (view === 'login' || !user) {
    return (
      <>
        <NoticeRegion notice={notice} onDismiss={() => setNotice(null)} />
        <div className="hero-wrapper">
          <div className="hero-content">
          <div className="hero-text-side">
            <div className="badge-pill">✨ The easiest way to split bills</div>
            <h1 className="hero-title-large">
              Travel more.<br />Worry less.<br /><span className="text-gradient">Split instantly.</span>
            </h1>
            <p className="hero-desc">Track shared expenses for trips, dinners, and roommates. No more awkward math or lost receipts.</p>
            <button className="btn btn-primary btn-large" onClick={handleGoogleLogin}>
              <div style={{ background: 'white', borderRadius: '50%', padding: '4px', display: 'flex', marginRight: '12px' }}>
                <GoogleIcon />
              </div>
              Continue with Google
            </button>
            <div className="trust-badge">
              <div className="avatars"><span className="avatar">👤</span><span className="avatar">😎</span><span className="avatar">🤠</span></div>
              <p>Join your friends on GroupTab</p>
            </div>
          </div>
          <div className="hero-visual-side">
            <div className="mockup-phone">
              <div className="mockup-header"><div className="mockup-notch"></div><div className="mockup-title">NYC Trip 🗽</div></div>
              <div className="mockup-body">
                <div className="mockup-row"><div className="icon-circle">🍕</div><div className="row-text"><div className="row-title">Joe's Pizza</div><div className="row-sub">Paid by Ashton</div></div><div className="row-price text-red">-$15.00</div></div>
                <div className="mockup-row"><div className="icon-circle">🚕</div><div className="row-text"><div className="row-title">Uber to Hotel</div><div className="row-sub">Paid by Therese</div></div><div className="row-price text-green">+$8.50</div></div>
                <div className="mockup-row"><div className="icon-circle">🍸</div><div className="row-text"><div className="row-title">Rooftop Drinks</div><div className="row-sub">Paid by ElJohn</div></div><div className="row-price text-red">-$22.00</div></div>
                <div className="mockup-floating-card"><span>💸 You owe Wes</span><strong>$22.00</strong></div>
              </div>
            </div>
          </div>
          </div>
        </div>
      </>
    )
  }

  return (
    <div className="app-container">

      {/* HEADER */}
      <NoticeRegion notice={notice} onDismiss={() => setNotice(null)} />
      <div className="app-header no-print">
        <div style={{ display: 'flex', alignItems: 'center', gap: '15px' }}>
          <h2 className="header-title" style={{ margin: 0, fontSize: '1.8rem', cursor: 'pointer' }} onClick={goHome}>GroupTab 📁</h2>
          <span style={{ fontSize: '0.9rem', color: 'var(--text-muted)', background: 'rgba(255,255,255,0.1)', padding: '4px 10px', borderRadius: '20px' }}>
            {user.displayName ? user.displayName.split(' ')[0] : 'User'}
          </span>
        </div>
        <div style={{ display: 'flex', gap: '10px' }}>
          {view !== 'dashboard' && <button className="back-btn" onClick={goHome}>Home</button>}
          <button className="back-btn" style={{ color: 'var(--danger)', borderColor: 'rgba(239, 68, 68, 0.3)' }} onClick={handleLogout}>Logout</button>
        </div>
      </div>

      {/* ---------------- VIEW 1: DASHBOARD ---------------- */}
      {view === 'dashboard' && (
        <div className="dashboard-container">
          <div className="dashboard-header">
            <div>
              <h1 className="dash-title">Welcome back, <span className="text-highlight">{user.displayName ? user.displayName.split(' ')[0] : 'Traveler'}</span></h1>
              <p className="dash-subtitle">Create a trip, join a group, or jump back into recent expenses.</p>
            </div>
            <div className="stat-pill"><span className="stat-num">{trips.length}</span><span className="stat-label">Active Trips</span></div>
          </div>

          <div className="create-bar-container">
            <div className="action-panel action-panel-create">
              <div className="action-title"><span className="action-icon">+</span>Create Trip</div>
              <div className="create-bar">
                <input
                  className="transparent-input"
                  placeholder="Madrid 2026"
                  value={newFolderName}
                  onChange={e => setNewFolderName(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && createFolder()}
                />
                <button className="btn-icon create-trip-button" onClick={createFolder}>Create</button>
              </div>
            </div>

            <div className="action-panel action-panel-join">
              <div className="action-title"><span className="action-icon">#</span>Join Trip</div>
              <div className="create-bar">
                <input
                  className="transparent-input"
                  placeholder="AB12CD34"
                  value={joinCodeInput}
                  maxLength={8}
                  onChange={e => setJoinCodeInput(e.target.value.toUpperCase())}
                  onKeyDown={(e) => e.key === 'Enter' && handleJoinTrip(joinCodeInput)}
                />
                <button className="btn-icon join-trip-button" onClick={() => handleJoinTrip(joinCodeInput)}>Join</button>
              </div>
            </div>
          </div>

          <div className="trips-section">
            <div className="trips-section-header">
              <h3 className="section-title">Your Trips</h3>
              <div className="trips-toolbar">
                <label className="trip-sort-label">Sort
                  <select value={tripSort} onChange={event => setTripSort(event.target.value)}>
                    <option value="newest">Newest created</option>
                    <option value="oldest">Oldest created</option>
                  </select>
                </label>
                <button className="clear-trips-btn" onClick={clearAllTrips} disabled={manageableTrips.length === 0 || isClearingTrips}>
                  {isClearingTrips ? 'Clearing...' : 'Clear All'}
                </button>
              </div>
            </div>
            {trips.length === 0 ? (
              <div className="empty-state"><div className="empty-icon"></div><p>No trips yet. Type a destination above to get started!</p></div>
            ) : (
              <div className="home-trip-grid">
                {[...trips].sort((a, b) => {
                  const difference = getTimestamp(b.createdAt) - getTimestamp(a.createdAt);
                  return tripSort === 'newest' ? difference : -difference;
                }).map(trip => (
                  (() => {
                    const uploadedCover = getUploadedTripCover(trip);
                    return (
                  <div
                    key={trip.id}
                    className={`folder-card home-trip-card${uploadedCover ? ' has-uploaded-cover' : ''}`}
                    onClick={() => openTrip(trip.id)}
                    style={uploadedCover ? { backgroundImage: uploadedCover, backgroundSize: 'cover', backgroundPosition: 'center' } : {}}
                  >
                    <div className="folder-content" style={uploadedCover ? { textShadow: '0 1px 3px rgba(0,0,0,.85)' } : {}}>
                      <div className="home-trip-top">
                        <span className="folder-icon" style={uploadedCover ? { filter: 'drop-shadow(0 1px 2px rgba(0,0,0,.7))' } : {}}>{tripEmojiMap[trip.id] || '🧳'}</span>
                        <div className="home-trip-actions">
                          <label className="trip-cover-button" onClick={event => event.stopPropagation()}>
                            <input type="file" accept="image/*" onChange={event => handleTripCoverUpload(event, trip)} />
                            {tripCoverUploads[trip.id] ? 'Uploading…' : uploadedCover ? 'Update cover' : 'Add cover'}
                          </label>
                          {uploadedCover && (
                            <button className="cover-remove-button" type="button" onClick={event => removeTripCover(event, trip)}>Remove cover</button>
                          )}
                          {isTripManager(trip) && (
                            <button className="delete-btn" onClick={(e) => deleteFolder(e, trip.id)} title="Delete trip">✕</button>
                          )}
                        </div>
                      </div>
                      <div className="folder-info">
                        <div className="folder-name">{trip.name}</div>
                        <div className="folder-meta" style={uploadedCover ? { color: '#f1f5f9' } : {}}>
                          <span>{getReceiptCount(trip)} receipt{getReceiptCount(trip) === 1 ? '' : 's'}</span>
                          <span className="meta-dot">{trip.expenseStorageVersion === 2 ? (trip.expenseCount || 0) : (trip.expenses?.length || 0)} expenses</span>
                          <span className="meta-dot">{trip.members?.length || 1} members</span>
                        </div>
                        <div className="home-trip-total" style={uploadedCover ? { textShadow: '0 1px 3px rgba(0,0,0,.85)' } : {}}>
                          <span>Total spent</span><strong>${getTripSpent(trip).toFixed(2)}</strong>
                        </div>
                        <div className="folder-date" style={uploadedCover ? { color: '#e2e8f0' } : {}}>
                          Updated {new Date(trip.lastUpdated?.toMillis?.() || trip.lastUpdated).toLocaleDateString()}
                        </div>
                      </div>
                    </div>

                  </div>
                    );
                  })()
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* ---------------- VIEW 2: TRIP OVERVIEW ---------------- */}
      {view === 'trip_view' && activeTrip && (
        <div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '5px', marginBottom: '20px' }}>
            <div className="trip-overview-heading">
              <div className="trip-title-group">
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                  {isEditingTitle ? (
                    <input
                      className="header-title-input"
                      value={tempTitle}
                      onChange={(e) => setTempTitle(e.target.value)}
                      onBlur={handleSaveTripName}
                      onKeyDown={(e) => e.key === 'Enter' && handleSaveTripName()}
                      autoFocus
                    />
                  ) : (
                    <h1 className="header-title trip-page-title" onClick={() => { setIsEditingTitle(true); setTempTitle(activeTrip.name); }}>
                      {activeTrip.name} <span style={{ fontSize: '1rem', opacity: 0.5, marginLeft: '10px', cursor: 'pointer', verticalAlign: 'middle' }}>✎</span>
                    </h1>
                  )}
                </div>
              </div>

              <div className="trip-invite-code">
              <span>Invite code</span>
              <strong>{activeTrip.joinCode || '------'}</strong>
              <button
                className="copy-code-button"
                type="button"
                onClick={async () => {
                  try {
                    await navigator.clipboard.writeText(activeTrip.joinCode);
                    showNotice('Invite code copied.', 'success');
                  } catch (error) {
                    console.error('Could not copy invite code:', error);
                    showNotice('Copy the invite code manually.', 'error');
                  }
                }}
                title="Copy invite code"
                aria-label="Copy invite code"
              >📋</button>
              </div>
            </div>
            <aside className="trip-spend-summary trip-spend-summary-wide" aria-label="Trip spending summary">
              <div className="trip-spend-marquee">
                <div className="trip-spend-track">
                  {[0, 1].map(copy => (
                    <div className="trip-spend-stat-set" key={copy} aria-hidden={copy === 1}>
                      <div className="trip-spend-stat total-spend-stat"><span>Total spent</span><strong>${tripTotal.toFixed(2)}</strong></div>
                      <div className="trip-spend-stat biggest-spend-stat"><span>Biggest spender</span><strong>{biggestSpender[0]} · ${biggestSpender[1].toFixed(2)}</strong></div>
                      <div className="trip-spend-stat lowest-spend-stat"><span>Lowest spender</span><strong>{lowestSpender[0]} · ${lowestSpender[1].toFixed(2)}</strong></div>
                      <div className="trip-spend-stat biggest-receipt-stat"><span>Most expensive receipt</span><strong>{biggestReceipt[0]} · ${biggestReceipt[1].toFixed(2)}</strong></div>
                      <div className="trip-spend-stat lowest-receipt-stat"><span>Least expensive receipt</span><strong>{lowestReceipt[0]} · ${lowestReceipt[1].toFixed(2)}</strong></div>
                      <div className="trip-spend-stat receipt-coverer-stat"><span>Most receipts covered</span><strong>Thanks, {topReceiptCoverer[0]} · {topReceiptCoverer[1]} receipt{topReceiptCoverer[1] === 1 ? '' : 's'}</strong></div>
                    </div>
                  ))}
                </div>
              </div>
            </aside>

            <section className="participants-panel">
              <div className="participants-heading">
                <div>
                  <h2>Trip participants</h2>
                  <p>Add everyone once; their names will be available on every receipt.</p>
                </div>
                <div className="participant-actions">
                  {!isAddingParticipant && (
                    <button className="participant-add-button" type="button" onClick={() => { setIsRemovingParticipant(false); setIsAddingParticipant(true); }}>+ Add participant</button>
                  )}
                  {!isRemovingParticipant && tripParticipants.length > 0 && (
                    <button className="participant-remove-button" type="button" onClick={() => { setIsAddingParticipant(false); setIsRemovingParticipant(true); setParticipantToRemove(tripParticipants[0] || ''); }}>Remove participant</button>
                  )}
                </div>
              </div>
              <div className="participant-list">
                {tripParticipants.map(person => (
                  <span className="participant-chip" key={person}>{person}</span>
                ))}
              </div>
              {isAddingParticipant && (
                <form className="participant-form" onSubmit={addTripParticipant}>
                  <input autoFocus value={newParticipantName} onChange={event => setNewParticipantName(event.target.value)} placeholder="Name" maxLength={60} />
                  <button className="btn btn-primary" type="submit">Add</button>
                  <button className="participant-cancel-button" type="button" onClick={() => { setNewParticipantName(''); setIsAddingParticipant(false); }}>Cancel</button>
                </form>
              )}
              {isRemovingParticipant && (
                <div className="participant-form participant-remove-form">
                  <select value={participantToRemove} onChange={event => setParticipantToRemove(event.target.value)} aria-label="Participant to remove">
                    {tripParticipants.map(person => <option key={person} value={person}>{person}</option>)}
                  </select>
                  <button className="participant-remove-confirm" type="button" onClick={() => removeTripParticipant(participantToRemove)}>Remove</button>
                  <button className="participant-cancel-button" type="button" onClick={() => { setParticipantToRemove(''); setIsRemovingParticipant(false); }}>Cancel</button>
                </div>
              )}
            </section>

            {!isTripManager(activeTrip) && (
              <div className="leave-trip-row">
                <span>You are a member of this trip.</span>
                <button className="text-danger-button" type="button" onClick={leaveTrip}>Leave trip</button>
              </div>
            )}

            {activeTrip.expenseStorageVersion !== 2 && isTripManager(activeTrip) && (
              <section className="data-upgrade-card">
                <div>
                  <h2>Improve shared editing</h2>
                  <p>Upgrade this trip so each receipt item saves independently. Existing receipts stay exactly the same.</p>
                </div>
                <button className="btn btn-primary" type="button" onClick={upgradeTripExpenses} disabled={isUpgradingExpenses}>
                  {isUpgradingExpenses ? 'Upgrading…' : 'Upgrade trip'}
                </button>
              </section>
            )}
          </div>

          <div className="layout-grid">
            {/* LEFT: RECEIPT TABS */}
            <div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '15px' }}>
                <h2 style={{ margin: 0 }}>Receipts</h2>
                <button className="btn btn-primary" style={{ width: 'auto', padding: '10px 20px' }} onClick={openReceiptBuilder}>+ Add New</button>
              </div>
              {tripLocations.length === 0 && <div style={{ color: 'var(--text-muted)', padding: '20px', border: '1px dashed var(--glass-border)', borderRadius: '10px' }}>No receipts yet.</div>}
              <div className="folder-grid" style={{ justifyContent: 'flex-start' }}>
                {tripLocations.map(loc => {
                  const coverImage = activeTrip.receiptCovers?.[loc] || activeTrip.receiptImages?.[loc];
                  const coverSettings = activeTrip.receiptCoverSettings?.[loc] || { positionX: 50, positionY: 50, zoom: 1 };
                  const cardColor = activeTrip.receiptColors?.[loc] || receiptColorOptions[0].value;
                  return (
                    <div key={loc} className={`folder-card receipt-tile${coverImage ? ' has-cover' : ''}`} style={!coverImage ? { backgroundColor: cardColor } : {}} onClick={() => openLocationTab(loc)}>
                      {coverImage && <img className="receipt-tile-cover" src={coverImage} alt="" style={{ objectPosition: `${coverSettings.positionX}% ${coverSettings.positionY}%`, transform: `scale(${coverSettings.zoom})`, transformOrigin: `${coverSettings.positionX}% ${coverSettings.positionY}%` }} />}
                      <div className="receipt-tile-content">
                        <span className="receipt-tile-icon">🧾</span>
                        <div className="receipt-tile-name">{loc}</div>
                      </div>
                      <label className="receipt-cover-button" onClick={event => event.stopPropagation()}>
                        <input type="file" accept="image/*" onChange={event => openReceiptCoverEditor(event, loc)} />
                        {coverUploads[loc] ? 'Uploading…' : coverImage ? 'Change cover' : 'Add cover'}
                      </label>
                      {activeTrip.receiptCovers?.[loc] && (
                        <button className="cover-remove-button receipt-cover-remove" type="button" onClick={event => { event.stopPropagation(); removeReceiptCover(loc); }}>Remove cover</button>
                      )}
                      {!coverImage && (
                        <div className="receipt-color-select" role="group" aria-label={`Card color for ${loc}`} onClick={event => event.stopPropagation()}>
                          <span>Color</span>
                          <div className="receipt-color-swatches">
                            {receiptColorOptions.map(option => (
                              <button
                                key={option.value}
                                type="button"
                                className={`receipt-color-swatch${cardColor === option.value ? ' is-selected' : ''}`}
                                style={{ backgroundColor: option.value }}
                                onClick={() => updateReceiptColor(loc, option.value)}
                                aria-label={`Use ${option.label.toLowerCase()} card color`}
                                aria-pressed={cardColor === option.value}
                                title={option.label}
                              />
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            </div>

            {/* RIGHT: TRIP CALCULATIONS */}
            <div>
              <div className="card">
                <h2 style={{ marginTop: 0 }}>Final Settlement</h2>
                <p style={{ fontSize: '0.9rem', color: 'var(--text-muted)' }}>Calculates net debts across ALL receipts.</p>
                <button className="btn btn-primary" onClick={calculateTripSettlement} disabled={isLoading || tripExpenses.length === 0}>
                  {isLoading ? 'Calculating...' : 'Calculate Who Owes Who'}
                </button>
              </div>

              {hasCalculated && (
                <div className="card settlement-card" style={{ padding: '24px' }}>
                  <h2 style={{ marginTop: 0, color: 'var(--success)', marginBottom: '20px' }}>Final Settlements</h2>
                  {results.length === 0 ? (
                    <p className="settled-empty-state">Everyone is settled up. No payments are needed.</p>
                  ) : (
                    <div style={{ display: 'grid', gap: '20px', gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))' }}>
                    {Object.entries(results.reduce((groups, settlement) => {
                      if (!groups[settlement.creditor]) groups[settlement.creditor] = [];
                      groups[settlement.creditor].push(settlement);
                      return groups;
                    }, {})).map(([creditorName, debts]) => (
                      <div key={creditorName} style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid var(--glass-border)', borderRadius: '16px', padding: '16px' }}>
                        <h3 style={{ marginTop: 0, marginBottom: '16px', color: 'var(--success)', borderBottom: '1px solid var(--glass-border)', paddingBottom: '12px', fontSize: '1.1rem' }}>
                          Owed to {creditorName}
                        </h3>

                        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                          {debts.map((debt) => {
                            const isSettled = activeTrip.settledDebts?.includes(debt.id) || activeTrip.settledDebts?.includes(debt.legacyLine);

                            return (
                              <div key={debt.id} style={{
                                display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                                opacity: isSettled ? 0.4 : 1, transition: 'opacity 0.2s'
                              }}>
                                <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flex: 1 }}>
                                  <button
                                    onClick={() => toggleSettlement(debt)}
                                    title={isSettled ? "Mark as unpaid" : "Mark as paid"}
                                    aria-label={`${isSettled ? 'Mark unpaid' : 'Mark paid'}: ${debt.debtor} owes ${debt.creditor} $${debt.amount.toFixed(2)}`}
                                    style={{
                                      background: isSettled ? 'var(--success)' : 'transparent',
                                      border: '1px solid var(--success)',
                                      color: isSettled ? 'white' : 'var(--success)',
                                      borderRadius: '50%', width: '24px', height: '24px',
                                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                                      cursor: 'pointer', fontSize: '0.8rem', flexShrink: 0
                                    }}
                                  >{isSettled ? '✓' : ''}</button>
                                  <span style={{ color: 'var(--text-main)', textDecoration: isSettled ? 'line-through' : 'none' }}>{debt.debtor}</span>
                                </div>
                                <span style={{ color: 'var(--success)', fontWeight: 'bold', textDecoration: isSettled ? 'line-through' : 'none' }}>${debt.amount.toFixed(2)}</span>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    ))}
                    </div>
                  )}
                </div>
              )}

              {tripExpenses.length > 0 && (
                <div style={{ marginTop: '30px' }}>
                  <h3 style={{ marginBottom: '15px', paddingLeft: '10px' }}>Total Trip Breakdown</h3>
                  <div className="breakdown-grid">
                    {Object.entries(getBreakdown(tripExpenses)).map(([person, data]) => {
                      const breakdownKey = `trip:${person}`;
                      const isCollapsed = collapsedBreakdowns[breakdownKey];
                      return (
                        <div key={person} className={`spreadsheet-card${isCollapsed ? ' is-collapsed' : ''}`}>
                          <button className="spreadsheet-header breakdown-toggle" type="button" onClick={() => toggleBreakdown(breakdownKey)} aria-expanded={!isCollapsed}>
                            <span>{person}</span><span aria-hidden="true">{isCollapsed ? '⌄' : '⌃'}</span>
                          </button>
                          {!isCollapsed && <div className="spreadsheet-body">
                            {data.items.map((i, idx) => (
                              <div key={idx} className="line-item"><span>{i.name} <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>({i.location})</span></span><span>{i.cost.toFixed(2)}</span></div>
                            ))}
                          </div>}
                          <div className="spreadsheet-footer">
                            <div className="summary-row"><span>Subtotal</span><span>{data.subtotal.toFixed(2)}</span></div>
                            <div className="grand-total-row"><span>TOTAL</span><span>${data.grandTotal.toFixed(2)}</span></div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ---------------- VIEW 3: SINGLE RECEIPT DETAIL ---------------- */}
      {view === 'receipt_detail' && activeLocation && (
        <div className="container print-container">
          <div className="no-print">
            <button className="back-btn" onClick={() => setView('trip_view')} style={{ marginBottom: '12px' }}>← Back to Trip</button>
          </div>

          <div className="receipt-detail-heading">
            <h1 className="header-title" style={{ margin: 0 }}>{activeLocation} <span className="no-print" style={{ fontSize: '0.5em', opacity: 0.5 }}>Receipt</span></h1>
            <aside className="receipt-spend-summary" aria-label="Receipt spending summary">
              <span>Receipt total</span>
              <strong>${receiptTotal.toFixed(2)}</strong>
              <small>{locationExpenses.length} item{locationExpenses.length === 1 ? '' : 's'}</small>
            </aside>
          </div>

          <div className="action-bar no-print">
            <button className="btn-action btn-edit" onClick={() => loadReceiptBatch(activeLocation)}><span>✎</span> Edit / Add Items</button>
            <button className="btn-action btn-pdf" onClick={printReceipt}><span>📄</span> Save as PDF</button>
            <label className="btn-action btn-upload">
              <span>📷</span> {receiptImageUploads[activeLocation] ? 'Uploading…' : 'Upload Photo'}
              <input type="file" accept="image/*" style={{ display: 'none' }} disabled={receiptImageUploads[activeLocation]} onChange={(e) => handleReceiptImageUpload(e, activeLocation)} />
            </label>
            {activeTrip.receiptImages?.[activeLocation] && (
              <button className="btn-action btn-remove-photo" onClick={() => removeReceiptImage(activeLocation)}><span>×</span> Remove Photo</button>
            )}
          </div>

          {activeTrip.receiptImages && activeTrip.receiptImages[activeLocation] && (
            <div className="receipt-photo-preview">
              <img src={activeTrip.receiptImages[activeLocation]} alt="Receipt" />
            </div>
          )}

          <div className="layout-grid">
            <div className="card">
              <h3 style={{ marginTop: 0 }}>Receipt Items</h3>
              <div className="items-grid">
                {locationExpenses.map(exp => (
                  <div key={exp.id} className="expense-box">
                    <div>
                      <div style={{ fontWeight: 'bold', fontSize: '1rem', color: 'white' }}>{exp.item}</div>
                      <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>Shared by: <span style={{ color: 'white' }}>{exp.involved.join(', ')}</span></div>
                      <div style={{ fontSize: '0.8rem', color: 'var(--primary)', marginTop: '4px' }}>
                        Paid by: {exp.payer}
                      </div>
                    </div>
                    <div className="expense-box-footer" style={{ display: 'flex', alignItems: 'center', gap: '15px' }}>
                      <span style={{ color: 'var(--success)', fontWeight: 'bold', fontSize: '1.1rem' }}>${exp.amount.toFixed(2)}</span>
                      <div className="no-print" style={{ display: 'flex', gap: '10px' }}>
                        <span style={{ cursor: 'pointer', fontSize: '1.2rem' }} onClick={() => editSavedExpense(exp)}>✎</span>
                        <span style={{ cursor: 'pointer', fontSize: '1.2rem', color: 'var(--danger)' }} onClick={() => deleteExpense(exp.id)}>✕</span>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div>
              <h3 style={{ marginTop: 0, marginBottom: '15px', paddingLeft: '10px' }}>Split Breakdown</h3>
              <div className="breakdown-grid">
                {Object.entries(getBreakdown(locationExpenses)).map(([person, data]) => {
                  const breakdownKey = `receipt:${activeLocation}:${person}`;
                  const isCollapsed = collapsedBreakdowns[breakdownKey];
                  return (
                    <div key={person} className={`spreadsheet-card${isCollapsed ? ' is-collapsed' : ''}`}>
                      <button className="spreadsheet-header breakdown-toggle" type="button" onClick={() => toggleBreakdown(breakdownKey)} aria-expanded={!isCollapsed}>
                        <span>{person}</span><span aria-hidden="true">{isCollapsed ? '⌄' : '⌃'}</span>
                      </button>
                      {!isCollapsed && <div className="spreadsheet-body">
                        {data.items.map((i, idx) => (
                          <div key={idx} className="line-item"><span>{i.name}</span><span>{i.cost.toFixed(2)}</span></div>
                        ))}
                      </div>}
                      <div className="spreadsheet-footer">
                        <div className="summary-row"><span>Subtotal</span><span>{data.subtotal.toFixed(2)}</span></div>
                        <div className="grand-total-row"><span>TOTAL</span><span>${data.grandTotal.toFixed(2)}</span></div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ---------------- VIEW 4: EDITOR ---------------- */}
      {view === 'receipt_editor' && (
        <div className="container">
          <button className="back-btn" onClick={() => setView('trip_view')} style={{ marginBottom: '20px' }}>Cancel</button>
          <div className="card">
            <h2 style={{ marginTop: 0, color: 'var(--primary)' }}>
              {editingLocationBatch
                ? `Editing Receipt: ${editingLocationBatch}`
                : (editingTripExpenseId ? `Edit Item in ${receiptLoc}` : "New Receipt")}
            </h2>

            <div className="input-row" style={{ display: 'flex', gap: '15px', marginBottom: '15px' }}>
              <div className="input-group" style={{ flex: 1 }}><label>Location</label><input placeholder="e.g. Cowfish" value={receiptLoc} onChange={e => setReceiptLoc(e.target.value)} /></div>
              <div className="input-group" style={{ flex: 1 }}><label>Payer</label><input list="trip-participants" placeholder="e.g. Ashton" value={receiptPayer} onChange={e => setReceiptPayer(e.target.value)} /></div>
            </div>
            <datalist id="trip-participants">{allAvailablePeople.map(person => <option key={person} value={person} />)}</datalist>

            <div style={{ background: 'rgba(255,255,255,0.05)', padding: '20px', borderRadius: '16px', marginBottom: '20px', border: editingIndex !== null ? '1px solid var(--success)' : '1px solid var(--glass-border)' }}>
              <div className="input-row" style={{ display: 'flex', gap: '10px' }}>
                <div style={{ flex: 0.8 }}><label style={{ fontSize: '0.7rem' }}>Qty</label><input type="number" value={quantity} onChange={e => setQuantity(e.target.value)} style={{ textAlign: 'center' }} /></div>
                <div style={{ flex: 2 }}><label style={{ fontSize: '0.7rem' }}>Item</label><input placeholder="Item Name" value={itemName} onChange={e => setItemName(e.target.value)} /></div>
                <div style={{ flex: 1.2 }}><label style={{ fontSize: '0.7rem' }}>Price</label><input type="number" placeholder="0.00" value={unitPrice} onChange={e => setUnitPrice(e.target.value)} /></div>
              </div>

              <div className="input-group" style={{ marginTop: '15px' }}>
                <label style={{ fontSize: '0.7rem', marginBottom: '10px' }}>Consumers (Select who to charge)</label>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', marginBottom: '12px' }}>
                  {allAvailablePeople.map(person => {
                    const isSelected = selectedConsumers.includes(person);

                    return (
                      <div
                        key={person}
                        onClick={() => toggleConsumer(person)}
                        style={{
                          display: 'flex', alignItems: 'center', gap: '8px',
                          padding: '8px 14px', borderRadius: '20px',
                          border: isSelected ? '1px solid var(--primary)' : '1px solid var(--glass-border)',
                          background: isSelected ? 'var(--primary)' : 'rgba(255,255,255,0.05)',
                          color: isSelected ? '#ffffff' : 'var(--text-main)',
                          cursor: 'pointer', fontSize: '0.85rem', fontWeight: '600', transition: 'all 0.2s', userSelect: 'none'
                        }}
                      >
                        {person}
                      </div>
                    );
                  })}
                </div>
              </div>

              <div style={{ marginTop: '15px', display: 'flex', gap: '10px' }}>
                <button className="btn btn-primary" style={{ padding: '12px', fontSize: '0.9rem', background: editingIndex !== null ? 'var(--success)' : '', width: 'auto' }} onClick={handleAddOrUpdateItem}>
                  {editingIndex !== null ? 'Update Item' : '+ Add Item'}
                </button>
              </div>
            </div>

            {currentItems.length > 0 && (
              <ul style={{ paddingLeft: 0, listStyle: 'none', marginBottom: '20px' }}>
                {currentItems.map((item, idx) => (
                  <li key={idx} style={{ background: 'rgba(255,255,255,0.05)', padding: '12px', marginBottom: '8px', borderRadius: '8px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <div>
                      <span style={{ fontWeight: 'bold' }}>{item.qty}x {item.name}</span> <span style={{ color: 'var(--text-muted)' }}>(${item.totalPrice.toFixed(2)})</span>
                      <div style={{ fontSize: '0.75rem', color: 'var(--primary-glow)' }}>{item.consumers.join(', ')}</div>
                    </div>
                    <div style={{ cursor: 'pointer', padding: '5px' }} onClick={() => startEditingDraftItem(idx)}>✎</div>
                  </li>
                ))}
              </ul>
            )}

            <div className="input-row" style={{ display: 'flex', gap: '15px', marginTop: '20px' }}>
              <div className="input-group" style={{ flex: 1 }}><div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '5px' }}><label>Tax</label><span onClick={() => setTaxMode(taxMode === '$' ? '%' : '$')} style={{ color: 'var(--primary)', cursor: 'pointer', fontWeight: 'bold' }}>{taxMode}</span></div><input type="number" value={receiptTax} onChange={e => setReceiptTax(e.target.value)} /></div>
              <div className="input-group" style={{ flex: 1 }}><div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '5px' }}><label>Tip</label><span onClick={() => setTipMode(tipMode === '$' ? '%' : '$')} style={{ color: 'var(--primary)', cursor: 'pointer', fontWeight: 'bold' }}>{tipMode}</span></div><input type="number" value={receiptTip} onChange={e => setReceiptTip(e.target.value)} /></div>
            </div>
            <button className="btn btn-primary" style={{ marginTop: '30px' }} onClick={saveReceiptToTrip}>{editingTripExpenseId || editingLocationBatch ? "Save Changes" : "Save Receipt"}</button>
          </div>
        </div>
      )}

      {coverEditor && (
        <div className="cover-editor-backdrop" role="dialog" aria-modal="true" aria-labelledby="cover-editor-title">
          <div className="cover-editor">
            <div className="cover-editor-header">
              <div>
                <h2 id="cover-editor-title">Frame your cover</h2>
                <p>Adjust the photo before using it for {coverEditor.location}.</p>
              </div>
              <button className="cover-editor-close" type="button" onClick={closeCoverEditor} aria-label="Close">×</button>
            </div>
            <div className="cover-editor-preview">
              <img src={coverEditor.previewUrl} alt="Cover preview" style={{ objectPosition: `${coverCrop.positionX}% ${coverCrop.positionY}%`, transform: `scale(${coverCrop.zoom})`, transformOrigin: `${coverCrop.positionX}% ${coverCrop.positionY}%` }} />
            </div>
            <div className="cover-editor-controls">
              <label>Horizontal position <input type="range" min="0" max="100" value={coverCrop.positionX} onChange={event => setCoverCrop(current => ({ ...current, positionX: Number(event.target.value) }))} /></label>
              <label>Vertical position <input type="range" min="0" max="100" value={coverCrop.positionY} onChange={event => setCoverCrop(current => ({ ...current, positionY: Number(event.target.value) }))} /></label>
              <label>Zoom <input type="range" min="1" max="2" step="0.01" value={coverCrop.zoom} onChange={event => setCoverCrop(current => ({ ...current, zoom: Number(event.target.value) }))} /></label>
            </div>
            <div className="cover-editor-actions">
              <button className="back-btn" type="button" onClick={closeCoverEditor}>Cancel</button>
              <button className="btn btn-primary" type="button" onClick={uploadReceiptCover} disabled={coverUploads[coverEditor.location]}>{coverUploads[coverEditor.location] ? 'Uploading…' : 'Use this cover'}</button>
            </div>
          </div>
        </div>
      )}
      <ConfirmationDialog confirmation={confirmation} onCancel={closeConfirmation} onConfirm={confirmAction} />
    </div>
  );
}

export default App
