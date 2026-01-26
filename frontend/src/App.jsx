import { useState, useEffect, useRef } from 'react'
import './App.css'

// --- FIREBASE IMPORTS ---
import { auth, googleProvider, db } from './firebase'
import { signInWithPopup, signOut, onAuthStateChanged } from 'firebase/auth'
import { doc, setDoc, onSnapshot } from 'firebase/firestore'

// --- ASSETS ---
const GoogleIcon = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
    <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/>
    <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
    <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/>
    <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
  </svg>
);

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

  // --- EDITING STATES ---
  const [isEditingTitle, setIsEditingTitle] = useState(false)
  const [tempTitle, setTempTitle] = useState('')

  // --- BACKGROUND PICKER STATE ---
  const [showBgPicker, setShowBgPicker] = useState(null) // Stores ID of trip being edited
  const [customImageUrl, setCustomImageUrl] = useState('')
  const fileInputRef = useRef(null)

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
  const [itemConsumer, setItemConsumer] = useState('')

  // EDITING EXPENSE STATE
  const [editingIndex, setEditingIndex] = useState(null) 
  const [editingTripExpenseId, setEditingTripExpenseId] = useState(null) 

  // Results
  const [results, setResults] = useState([])
  const [isLoading, setIsLoading] = useState(false)

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
      const userDocRef = doc(db, "users", user.uid)
      const unsub = onSnapshot(userDocRef, (docSnap) => {
        if (docSnap.exists()) {
          setTrips(docSnap.data().trips || [])
        }
      })
      return () => unsub()
    }
  }, [user])

  const saveToCloud = async (updatedTrips) => {
    setTrips(updatedTrips) 
    if (user) {
      try {
        await setDoc(doc(db, "users", user.uid), { trips: updatedTrips }, { merge: true })
      } catch (e) {
        console.error("Error saving to cloud: ", e)
      }
    }
  }

  // ==========================================
  // AUTH ACTIONS
  // ==========================================
  const handleGoogleLogin = async () => {
    try {
      await signInWithPopup(auth, googleProvider)
    } catch (error) {
      console.error(error)
      alert("Login failed")
    }
  }

  const handleLogout = async () => {
    await signOut(auth)
  }

  // ==========================================
  // HELPER: GET DATA
  // ==========================================
  const activeTrip = trips.find(t => t.id === activeTripId)
  
  const locationExpenses = activeTrip 
    ? activeTrip.expenses.filter(e => e.location === activeLocation)
    : []

  const tripLocations = activeTrip
    ? [...new Set(activeTrip.expenses.map(e => e.location))]
    : []

  // Current Theme for Active Location (Receipt View)
  const activeReceiptTheme = activeTrip?.themes?.[activeLocation] || null;

  // ==========================================
  // NAVIGATION ACTIONS
  // ==========================================
  const goHome = () => {
    setView('dashboard')
    setActiveTripId(null)
    setActiveLocation(null)
    setShowBgPicker(null)
  }

  const openTrip = (id) => {
    // Only open if we aren't clicking the background picker button
    setActiveTripId(id)
    setView('trip_view')
    setResults([]) 
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
    setView('receipt_editor')
  }

  // ==========================================
  // DATA ACTIONS
  // ==========================================
  const createFolder = () => {
    if (!newFolderName.trim()) return
    const newTrip = {
      id: Date.now(),
      name: newFolderName,
      expenses: [],
      themes: {}, // For receipt backgrounds
      background: '' // For trip card background
    }
    const updated = [...trips, newTrip]
    saveToCloud(updated)
    setNewFolderName('')
  }

  const deleteFolder = (e, id) => {
    e.stopPropagation() 
    if (confirm("Delete this entire trip folder?")) {
      const updated = trips.filter(t => t.id !== id)
      saveToCloud(updated)
    }
  }

  const deleteExpense = (expenseId) => {
    const updatedTrips = trips.map(t => {
      if (t.id === activeTripId) {
        return { ...t, expenses: t.expenses.filter(e => e.id !== expenseId) }
      }
      return t
    })
    saveToCloud(updatedTrips)
  }

  // --- UPDATE TRIP COVER (Dashboard) ---
  const updateTripBackground = (tripId, bgValue) => {
    const updatedTrips = trips.map(t => 
      t.id === tripId ? { ...t, background: bgValue } : t
    )
    saveToCloud(updatedTrips)
    setShowBgPicker(null)
    setCustomImageUrl('')
  }

  // --- FILE UPLOAD HANDLER ---
  const handleFileUpload = (e, tripId) => {
    const file = e.target.files[0];
    if (file) {
      const reader = new FileReader();
      reader.onloadend = () => {
        // Reader result is the Base64 string
        updateTripBackground(tripId, `url(${reader.result})`);
      };
      reader.readAsDataURL(file);
    }
  };

  // --- UPDATE RECEIPT THEME (Detail View) ---
  const updateReceiptTheme = (themeValue) => {
    if (!activeTrip || !activeLocation) return;
    const updatedTrips = trips.map(t => {
      if (t.id === activeTripId) {
        return {
          ...t,
          themes: { ...(t.themes || {}), [activeLocation]: themeValue }
        }
      }
      return t
    })
    saveToCloud(updatedTrips)
    setShowBgPicker(null) 
  }

  // --- EDIT TRIP NAME ---
  const handleSaveTripName = () => {
    if (!tempTitle.trim()) {
      setIsEditingTitle(false)
      return
    }
    const updatedTrips = trips.map(t => 
      t.id === activeTripId ? { ...t, name: tempTitle } : t
    )
    saveToCloud(updatedTrips)
    setIsEditingTitle(false)
  }

  // --- EDIT SAVED EXPENSE ---
  const editSavedExpense = (expense) => {
    setEditingTripExpenseId(expense.id)
    setReceiptLoc(expense.location)
    setReceiptPayer(expense.payer)
    
    const name = expense.rawName || expense.item.replace(/^\d+x\s/, '') 
    const qty = expense.rawQty || 1
    const price = expense.rawUnitPrice || expense.originalPrice / qty

    const reconstructedItem = {
      name: name,
      qty: qty,
      unitPrice: price,
      totalPrice: expense.originalPrice,
      consumers: expense.involved
    }
    setCurrentItems([reconstructedItem])

    setReceiptTax(expense.taxShare.toFixed(2))
    setReceiptTip(expense.tipShare.toFixed(2))
    setTaxMode('$') 
    setTipMode('$')

    setView('receipt_editor')
  }

  // --- SERVERLESS CALCULATION ---
  const calculateTripSettlement = () => {
    if (!activeTrip || activeTrip.expenses.length === 0) return;
    setIsLoading(true);
    setTimeout(() => {
      const settlementPlan = calculateDebts(activeTrip.expenses);
      setResults(settlementPlan);
      setIsLoading(false);
    }, 500); 
  }

  // --- BUILDER ACTIONS ---
  const handleAddOrUpdateItem = () => {
    if (!itemName || !unitPrice || !itemConsumer) return alert("Fill item details")
    const qty = parseFloat(quantity) || 1
    const price = parseFloat(unitPrice)
    const totalLineCost = price * qty 
    const newItem = {
      name: itemName,
      qty: qty,
      unitPrice: price,
      totalPrice: totalLineCost, 
      consumers: itemConsumer.split(',').map(n => n.trim())
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
  }

  const startEditingDraftItem = (index) => {
    const item = currentItems[index]
    setItemName(item.name)
    setUnitPrice(item.unitPrice)
    setQuantity(item.qty)
    setItemConsumer(item.consumers.join(', '))
    setEditingIndex(index)
  }

  const saveReceiptToTrip = () => {
    if (!receiptLoc || !receiptPayer) return alert("Enter Location and Payer")
    if (currentItems.length === 0) return alert("Add items")

    const subtotal = currentItems.reduce((sum, item) => sum + item.totalPrice, 0)
    let taxTotal = parseFloat(receiptTax) || 0
    let tipTotal = parseFloat(receiptTip) || 0
    if (taxMode === '%') taxTotal = subtotal * (taxTotal / 100)
    if (tipMode === '%') tipTotal = subtotal * (tipTotal / 100)
    
    const taxRate = subtotal > 0 ? (taxTotal / subtotal) : 0
    const tipRate = subtotal > 0 ? (tipTotal / subtotal) : 0

    const newExpenses = currentItems.map(item => {
      const itemTax = item.totalPrice * taxRate
      const itemTip = item.totalPrice * tipRate
      return {
        id: editingTripExpenseId || (Date.now() + Math.random()), 
        item: `${item.qty}x ${item.name}`, 
        location: receiptLoc,
        payer: receiptPayer,
        amount: item.totalPrice + itemTax + itemTip,     
        involved: item.consumers,
        rawName: item.name,
        rawQty: item.qty,
        rawUnitPrice: item.unitPrice,
        originalPrice: item.totalPrice,
        taxShare: itemTax,
        tipShare: itemTip
      }
    })

    const updatedTrips = trips.map(t => {
      if (t.id === activeTripId) {
        let updatedExpenses = t.expenses
        if (editingTripExpenseId) {
          updatedExpenses = updatedExpenses.filter(e => e.id !== editingTripExpenseId)
        }
        return { ...t, expenses: [...updatedExpenses, ...newExpenses] }
      }
      return t
    })
    saveToCloud(updatedTrips)
    setActiveLocation(receiptLoc)
    setView('receipt_detail')
    setEditingTripExpenseId(null) 
  }

  const getBreakdown = (expensesList) => {
    const breakdown = {}
    expensesList.forEach(exp => {
      const numPeople = exp.involved.length
      const splitPrice = exp.originalPrice / numPeople
      const splitTax = exp.taxShare / numPeople
      const splitTip = exp.tipShare / numPeople
      const splitTotal = exp.amount / numPeople
      exp.involved.forEach(person => {
        if (!breakdown[person]) {
          breakdown[person] = { items: [], subtotal: 0, tax: 0, tip: 0, grandTotal: 0 }
        }
        breakdown[person].items.push({ 
          name: exp.item, 
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
  
  // --- LOGIN VIEW ---
  if (view === 'login' || !user) {
    return (
      <div className="hero-wrapper">
        <div className="hero-content">
          <div className="hero-text-side">
            <div className="badge-pill">✨ The easiest way to split bills</div>
            <h1 className="hero-title-large">
              Travel more.<br />Worry less.<br /><span className="text-gradient">Split instantly.</span>
            </h1>
            <p className="hero-desc">Track shared expenses for trips, dinners, and roommates. No more awkward math or lost receipts.</p>
            <button className="btn btn-primary btn-large" onClick={handleGoogleLogin}>
               <div style={{background: 'white', borderRadius: '50%', padding: '4px', display:'flex', marginRight:'12px'}}>
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
                <div className="mockup-row fade-1"><div className="icon-circle">🍕</div><div className="row-text"><div className="row-title">Joe's Pizza</div><div className="row-sub">Paid by Ashton</div></div><div className="row-price text-red">-$15.00</div></div>
                <div className="mockup-row fade-2"><div className="icon-circle">🚕</div><div className="row-text"><div className="row-title">Uber to Hotel</div><div className="row-sub">Paid by Therese</div></div><div className="row-price text-green">+$8.50</div></div>
                <div className="mockup-row fade-3"><div className="icon-circle">🍸</div><div className="row-text"><div className="row-title">Rooftop Drinks</div><div className="row-sub">Paid by ElJohn</div></div><div className="row-price text-red">-$22.00</div></div>
                <div className="mockup-floating-card float-anim"><span>💸 You owe Wes</span><strong>$22.00</strong></div>
              </div>
            </div>
          </div>
        </div>
      </div>
    )
  }

  // --- AUTHENTICATED APP ---
  return (
    <div className="app-container">
      <div className="background-glow"></div>
      
      {/* HEADER */}
      <div style={{marginBottom:'20px', borderBottom:'1px solid var(--glass-border)', paddingBottom:'10px', display:'flex', justifyContent:'space-between', alignItems:'center'}}>
        <div style={{display:'flex', alignItems:'center', gap:'15px'}}>
           <h2 className="header-title" style={{margin:0, fontSize:'1.8rem', cursor:'pointer'}} onClick={goHome}>GroupTab 📁</h2>
           <span style={{fontSize:'0.9rem', color:'var(--text-muted)', background: 'rgba(255,255,255,0.1)', padding: '4px 10px', borderRadius: '20px'}}>
             {user.displayName ? user.displayName.split(' ')[0] : 'User'}
           </span>
        </div>
        <div style={{display:'flex', gap:'10px'}}>
           {view !== 'dashboard' && <button className="back-btn" onClick={goHome}>Home</button>}
           <button className="back-btn" style={{color:'var(--danger)', borderColor: 'rgba(239, 68, 68, 0.3)'}} onClick={handleLogout}>Logout</button>
        </div>
      </div>
      
      {/* ---------------- VIEW 1: DASHBOARD ---------------- */}
      {view === 'dashboard' && (
        <div className="dashboard-container">
          <div className="dashboard-header">
            <div>
              <h1 className="dash-title">Welcome back, <span className="text-highlight">{user.displayName ? user.displayName.split(' ')[0] : 'Traveler'}</span></h1>
              <p className="dash-subtitle">Ready for your next adventure?</p>
            </div>
            <div className="stat-pill"><span className="stat-num">{trips.length}</span><span className="stat-label">Active Trips</span></div>
          </div>

          <div className="create-bar-container">
            <div className="create-bar">
              <span className="search-icon">✈️</span>
              <input className="transparent-input" placeholder="Where are you going next? (e.g. Tokyo 2026)" value={newFolderName} onChange={e => setNewFolderName(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && createFolder()}/>
              <button className="btn-icon" onClick={createFolder}>➝</button>
            </div>
          </div>

          <div className="trips-section">
            <h3 className="section-title">Your Trips</h3>
            {trips.length === 0 ? (
              <div className="empty-state"><div className="empty-icon">mntn</div><p>No trips yet. Type a destination above to get started!</p></div>
            ) : (
              <div className="folder-grid">
                {trips.map(trip => (
                  <div 
                    key={trip.id} 
                    className="folder-card" 
                    onClick={() => openTrip(trip.id)}
                    style={trip.background ? {backgroundImage: trip.background, backgroundSize: 'cover', backgroundPosition: 'center'} : {}}
                  >
                    <div className="folder-content" style={trip.background ? {textShadow: '0 2px 4px rgba(0,0,0,0.8)'} : {}}>
                      <span className="folder-icon" style={trip.background ? {filter: 'drop-shadow(0 2px 4px rgba(0,0,0,0.8))'} : {}}>🏝️</span>
                      <div className="folder-info">
                        <div className="folder-name">{trip.name}</div>
                        <div className="folder-meta" style={trip.background ? {color:'rgba(255,255,255,0.9)'} : {}}>{trip.expenses.length} expenses</div>
                      </div>
                    </div>
                    
                    {/* EDIT & DELETE BUTTONS */}
                    <div style={{display:'flex', gap:'5px', position:'absolute', top:'10px', right:'10px'}}>
                      <button 
                        className="delete-btn" 
                        onClick={(e) => { e.stopPropagation(); setShowBgPicker(showBgPicker === trip.id ? null : trip.id); }}
                      >
                        ✏️
                      </button>
                      <button className="delete-btn" onClick={(e) => deleteFolder(e, trip.id)}>✕</button>
                    </div>

                    {/* BACKGROUND PICKER POPUP (Specific to this trip) */}
                    {showBgPicker === trip.id && (
                      <div className="theme-picker-popup" onClick={e => e.stopPropagation()}>
                        <div style={{marginBottom:'12px', fontWeight:'bold', fontSize:'0.9rem'}}>Change Cover</div>
                        <div className="theme-options">
                          {/* 5 COLOR OPTIONS + DEFAULT */}
                          <div className="theme-circle" style={{background:'linear-gradient(135deg, #6366f1, #a855f7)'}} onClick={() => updateTripBackground(trip.id, 'linear-gradient(135deg, #6366f1, #a855f7)')}></div>
                          <div className="theme-circle" style={{background:'linear-gradient(135deg, #ec4899, #8b5cf6)'}} onClick={() => updateTripBackground(trip.id, 'linear-gradient(135deg, #ec4899, #8b5cf6)')}></div>
                          <div className="theme-circle" style={{background:'linear-gradient(135deg, #10b981, #3b82f6)'}} onClick={() => updateTripBackground(trip.id, 'linear-gradient(135deg, #10b981, #3b82f6)')}></div>
                          <div className="theme-circle" style={{background:'linear-gradient(135deg, #f59e0b, #ef4444)'}} onClick={() => updateTripBackground(trip.id, 'linear-gradient(135deg, #f59e0b, #ef4444)')}></div>
                          <div className="theme-circle" style={{background:'linear-gradient(135deg, #06b6d4, #3b82f6)'}} onClick={() => updateTripBackground(trip.id, 'linear-gradient(135deg, #06b6d4, #3b82f6)')}></div>
                          <div className="theme-circle" style={{background:'rgba(255,255,255,0.05)', border:'1px solid #555'}} onClick={() => updateTripBackground(trip.id, '')}></div>
                        </div>
                        
                        <div style={{marginTop:'15px', display:'flex', flexDirection:'column', gap:'10px'}}>
                          <input placeholder="Paste Image URL..." style={{fontSize:'0.9rem', padding:'8px'}} value={customImageUrl} onChange={e => setCustomImageUrl(e.target.value)}/>
                          <button className="btn btn-primary" style={{padding:'8px', fontSize:'0.9rem', width:'100%'}} onClick={() => updateTripBackground(trip.id, `url(${customImageUrl})`)}>Use URL</button>
                          
                          <div style={{display:'flex', alignItems:'center', gap:'5px', marginTop:'5px'}}>
                            <div style={{height:'1px', background:'rgba(255,255,255,0.2)', flex:1}}></div>
                            <span style={{fontSize:'0.7rem', color:'#888'}}>OR</span>
                            <div style={{height:'1px', background:'rgba(255,255,255,0.2)', flex:1}}></div>
                          </div>

                          {/* FILE UPLOAD INPUT (HIDDEN) & BUTTON */}
                          <input 
                            type="file" 
                            accept="image/*" 
                            style={{display:'none'}} 
                            ref={fileInputRef}
                            onChange={(e) => handleFileUpload(e, trip.id)}
                          />
                          <button className="upload-btn" onClick={() => fileInputRef.current.click()}>
                            📲 Upload from Device
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* ---------------- VIEW 2: TRIP OVERVIEW ---------------- */}
      {view === 'trip_view' && activeTrip && (
        <div>
          <div style={{display:'flex', alignItems:'center', gap:'10px', marginBottom:'20px'}}>
            {isEditingTitle ? (
              <input className="header-title-input" value={tempTitle} onChange={(e) => setTempTitle(e.target.value)} onBlur={handleSaveTripName} onKeyDown={(e) => e.key === 'Enter' && handleSaveTripName()} autoFocus />
            ) : (
              <h1 className="header-title" onClick={() => { setIsEditingTitle(true); setTempTitle(activeTrip.name); }}>
                {activeTrip.name} <span style={{fontSize:'1rem', opacity:0.5, marginLeft:'10px', cursor:'pointer', verticalAlign:'middle'}}>✎</span>
              </h1>
            )}
          </div>

          <div className="layout-grid">
            {/* LEFT: RECEIPT TABS */}
            <div>
              <div style={{display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:'15px'}}>
                 <h2 style={{margin:0}}>Receipts</h2>
                 <button className="btn btn-primary" style={{width:'auto', padding:'10px 20px'}} onClick={openReceiptBuilder}>+ Add New</button>
              </div>
              {tripLocations.length === 0 && <div style={{color:'var(--text-muted)', padding:'20px', border:'1px dashed var(--glass-border)', borderRadius:'10px'}}>No receipts yet.</div>}
              <div className="folder-grid" style={{justifyContent:'flex-start'}}>
                {tripLocations.map(loc => {
                  const locTheme = activeTrip.themes?.[loc];
                  const tileStyle = locTheme ? { backgroundImage: locTheme, backgroundSize: 'cover', backgroundPosition: 'center' } : {};
                  return (
                    <div key={loc} className="folder-card" style={{padding:'20px', ...tileStyle}} onClick={() => openLocationTab(loc)}>
                      <span style={{fontSize:'2rem', textShadow: locTheme ? '0 2px 4px rgba(0,0,0,0.5)' : 'none'}}>🧾</span>
                      <div style={{fontWeight:'bold', marginTop:'5px', color:'white', textShadow: locTheme ? '0 2px 4px rgba(0,0,0,0.8)' : 'none'}}>{loc}</div>
                    </div>
                  )
                })}
              </div>
            </div>

            {/* RIGHT: TRIP CALCULATIONS */}
            <div>
               <div className="card">
                 <h2 style={{marginTop:0}}>Final Settlement</h2>
                 <p style={{fontSize:'0.9rem', color:'var(--text-muted)'}}>Calculates net debts across ALL receipts.</p>
                 <button className="btn btn-primary" onClick={calculateTripSettlement} disabled={isLoading || activeTrip.expenses.length === 0}>
                   {isLoading ? 'Calculating...' : 'Calculate Who Owes Who'}
                 </button>
               </div>
               {results.length > 0 && (
                 <div className="card settlement-card">
                   <h2 style={{marginTop:0, color:'var(--success)'}}>Who Owes Who?</h2>
                   {results.map((line, idx) => <div key={idx} className="settlement-row">✅ {line}</div>)}
                 </div>
               )}
               {activeTrip.expenses.length > 0 && (
                 <div style={{marginTop:'30px'}}>
                    <h3 style={{marginBottom:'15px', paddingLeft:'10px'}}>Total Trip Breakdown</h3>
                    <div className="breakdown-grid"> 
                      {Object.entries(getBreakdown(activeTrip.expenses)).map(([person, data]) => (
                        <div key={person} className="spreadsheet-card">
                          <div className="spreadsheet-header">{person}</div>
                          <div className="spreadsheet-body">
                            {data.items.map((i, idx) => (
                               <div key={idx} className="line-item"><span>{i.name} <span style={{fontSize:'0.7rem', color:'var(--text-muted)'}}>({i.location})</span></span><span>{i.cost.toFixed(2)}</span></div>
                            ))}
                          </div>
                          <div className="spreadsheet-footer">
                             <div className="summary-row"><span>Subtotal</span><span>{data.subtotal.toFixed(2)}</span></div>
                             <div className="summary-row"><span>Tax</span><span>{data.tax.toFixed(2)}</span></div>
                             <div className="summary-row"><span>Tip</span><span>{data.tip.toFixed(2)}</span></div>
                             <div className="grand-total-row"><span>TOTAL</span><span>${data.grandTotal.toFixed(2)}</span></div>
                          </div>
                        </div>
                      ))}
                    </div>
                 </div>
               )}
            </div>
          </div>
        </div>
      )}

      {/* ---------------- VIEW 3: SINGLE RECEIPT DETAIL ---------------- */}
      {view === 'receipt_detail' && activeLocation && (
        <div className="container">
          <button className="back-btn" onClick={() => setView('trip_view')} style={{marginBottom:'20px'}}>← Back to Trip</button>
          
          <div style={{display:'flex', alignItems:'center', gap:'15px', marginBottom:'20px'}}>
            <h1 className="header-title" style={{margin:0}}>{activeLocation} <span style={{fontSize:'0.5em', opacity:0.5}}>Receipt</span></h1>
            <div style={{position:'relative'}}>
              <button className="btn-icon" style={{width:'36px', height:'36px', fontSize:'1rem', background:'rgba(255,255,255,0.1)'}} onClick={() => setShowBgPicker(!showBgPicker)}>🎨</button>
              
              {showBgPicker && (
                <div className="theme-picker-popup">
                  <div style={{marginBottom:'8px', fontWeight:'bold', fontSize:'0.8rem'}}>Change Card Background</div>
                  <div className="theme-options">
                    <div className="theme-circle" style={{background:'linear-gradient(135deg, #6366f1, #a855f7)'}} onClick={() => updateReceiptTheme('linear-gradient(135deg, #6366f1, #a855f7)')}></div>
                    <div className="theme-circle" style={{background:'linear-gradient(135deg, #ec4899, #8b5cf6)'}} onClick={() => updateReceiptTheme('linear-gradient(135deg, #ec4899, #8b5cf6)')}></div>
                    <div className="theme-circle" style={{background:'linear-gradient(135deg, #10b981, #3b82f6)'}} onClick={() => updateReceiptTheme('linear-gradient(135deg, #10b981, #3b82f6)')}></div>
                    <div className="theme-circle" style={{background:'linear-gradient(135deg, #f59e0b, #ef4444)'}} onClick={() => updateReceiptTheme('linear-gradient(135deg, #f59e0b, #ef4444)')}></div>
                    <div className="theme-circle" style={{background:'linear-gradient(135deg, #06b6d4, #3b82f6)'}} onClick={() => updateReceiptTheme('linear-gradient(135deg, #06b6d4, #3b82f6)')}></div>
                    <div className="theme-circle" style={{background:'rgba(255,255,255,0.05)', border:'1px solid #555'}} onClick={() => updateReceiptTheme('')}></div>
                  </div>
                  <div style={{marginTop:'10px', display:'flex', gap:'5px'}}>
                    <input placeholder="Image URL..." style={{fontSize:'0.8rem', padding:'6px'}} value={customImageUrl} onChange={e => setCustomImageUrl(e.target.value)}/>
                    <button className="btn btn-primary" style={{padding:'4px 8px', fontSize:'0.8rem', width:'auto'}} onClick={() => updateReceiptTheme(`url(${customImageUrl})`)}>Go</button>
                  </div>
                </div>
              )}
            </div>
          </div>
          
          <div className="layout-grid">
            <div className="card" style={ activeReceiptTheme ? { backgroundImage: activeReceiptTheme, backgroundSize: 'cover', backgroundPosition: 'center', boxShadow: '0 20px 50px rgba(0,0,0,0.5)' } : {}}>
              <h3 style={{marginTop:0, textShadow: activeReceiptTheme ? '0 2px 4px rgba(0,0,0,0.8)' : 'none'}}>Receipt Items</h3>
              <div className="items-grid">
                {locationExpenses.map(exp => (
                  <div key={exp.id} className="expense-box" style={activeReceiptTheme ? {background:'rgba(0,0,0,0.6)', borderColor:'rgba(255,255,255,0.2)'} : {}}>
                    <div>
                      <div style={{fontWeight:'bold', fontSize:'1rem', color:'white'}}>{exp.item}</div>
                      <div style={{fontSize:'0.8rem', color:'var(--text-muted)'}}>Shared by: <span style={{color:'white'}}>{exp.involved.join(', ')}</span></div>
                      {/* --- PAID BY SECTION --- */}
                      <div style={{fontSize:'0.8rem', color: activeReceiptTheme ? '#818cf8' : 'var(--primary-glow)', marginTop:'4px', fontWeight: activeReceiptTheme ? 'bold' : 'normal'}}>
                        Paid by: {exp.payer}
                      </div>
                    </div>
                    <div className="expense-box-footer" style={{display:'flex', alignItems:'center', gap:'15px'}}>
                       <span style={{color:'var(--success)', fontWeight:'bold', fontSize:'1.1rem'}}>${exp.amount.toFixed(2)}</span>
                       <div style={{display:'flex', gap:'10px'}}>
                          <span style={{cursor:'pointer', fontSize:'1.2rem'}} onClick={() => editSavedExpense(exp)}>✎</span>
                          <span style={{cursor:'pointer', fontSize:'1.2rem', color:'var(--danger)'}} onClick={() => deleteExpense(exp.id)}>✕</span>
                       </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
            
            {/* RIGHT COLUMN: BREAKDOWN */}
            <div>
              <h3 style={{marginTop:0, marginBottom:'15px', paddingLeft:'10px'}}>Split Breakdown</h3>
              <div className="breakdown-grid"> 
                {Object.entries(getBreakdown(locationExpenses)).map(([person, data]) => (
                  <div key={person} className="spreadsheet-card">
                    <div className="spreadsheet-header">{person}</div>
                    <div className="spreadsheet-body">
                      {data.items.map((i, idx) => (
                         <div key={idx} className="line-item"><span>{i.name}</span><span>{i.cost.toFixed(2)}</span></div>
                      ))}
                    </div>
                    <div className="spreadsheet-footer">
                       <div className="summary-row"><span>Subtotal</span><span>{data.subtotal.toFixed(2)}</span></div>
                       <div className="summary-row"><span>Tax</span><span>{data.tax.toFixed(2)}</span></div>
                       <div className="summary-row"><span>Tip</span><span>{data.tip.toFixed(2)}</span></div>
                       <div className="grand-total-row"><span>TOTAL</span><span>${data.grandTotal.toFixed(2)}</span></div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ---------------- VIEW 4: EDITOR ---------------- */}
      {view === 'receipt_editor' && (
        <div className="container">
          <button className="back-btn" onClick={() => setView('trip_view')} style={{marginBottom:'20px'}}>Cancel</button>
          <div className="card">
            <h2 style={{marginTop:0, color:'var(--primary)'}}>{editingTripExpenseId ? `Edit Item in ${receiptLoc}` : "New Receipt"}</h2>
            <div className="input-row" style={{display:'flex', gap:'15px', marginBottom:'15px'}}>
               <div className="input-group" style={{flex:1}}><label>Location</label><input placeholder="e.g. Cowfish" value={receiptLoc} onChange={e => setReceiptLoc(e.target.value)} /></div>
               <div className="input-group" style={{flex:1}}><label>Payer</label><input placeholder="e.g. Ashton" value={receiptPayer} onChange={e => setReceiptPayer(e.target.value)} /></div>
            </div>
            <div style={{background:'rgba(255,255,255,0.05)', padding:'20px', borderRadius:'16px', marginBottom:'20px', border: editingIndex !== null ? '1px solid var(--success)' : '1px solid var(--glass-border)'}}>
               <div className="input-row" style={{display:'flex', gap:'10px'}}>
                  <div style={{flex:0.8}}><label style={{fontSize:'0.7rem'}}>Qty</label><input type="number" value={quantity} onChange={e => setQuantity(e.target.value)} style={{textAlign:'center'}}/></div>
                  <div style={{flex:2}}><label style={{fontSize:'0.7rem'}}>Item</label><input placeholder="Item Name" value={itemName} onChange={e => setItemName(e.target.value)} /></div>
                  <div style={{flex:1.2}}><label style={{fontSize:'0.7rem'}}>Price</label><input type="number" placeholder="0.00" value={unitPrice} onChange={e => setUnitPrice(e.target.value)} /></div>
               </div>
               <div className="input-group" style={{marginTop:'15px'}}><label style={{fontSize:'0.7rem'}}>Consumers</label><input placeholder="Who ate this? (e.g. Ashton, Bob)" value={itemConsumer} onChange={e => setItemConsumer(e.target.value)} /></div>
               <div style={{marginTop:'15px', display:'flex', gap:'10px'}}>
                  <button className="btn btn-primary" style={{padding:'12px', fontSize:'0.9rem', background: editingIndex!==null?'var(--success)':'', width:'auto'}} onClick={handleAddOrUpdateItem}>
                    {editingIndex!==null ? 'Update Item' : '+ Add Item'}
                  </button>
               </div>
            </div>
            {currentItems.length > 0 && (
              <ul style={{paddingLeft:0, listStyle:'none', marginBottom:'20px'}}>
                {currentItems.map((item, idx) => (
                  <li key={idx} style={{background:'rgba(255,255,255,0.05)', padding:'12px', marginBottom:'8px', borderRadius:'8px', display:'flex', justifyContent:'space-between', alignItems:'center'}}>
                    <div><span style={{fontWeight:'bold'}}>{item.qty}x {item.name}</span> <span style={{color:'var(--text-muted)'}}>(${item.totalPrice.toFixed(2)})</span></div>
                    <div style={{cursor:'pointer', padding:'5px'}} onClick={()=>startEditingDraftItem(idx)}>✎</div>
                  </li>
                ))}
              </ul>
            )}
            <div className="input-row" style={{display:'flex', gap:'15px', marginTop:'20px'}}>
               <div className="input-group" style={{flex:1}}><div style={{display:'flex', justifyContent:'space-between', marginBottom:'5px'}}><label>Tax</label><span onClick={()=>setTaxMode(taxMode==='$'?'%':'$')} style={{color:'var(--primary)', cursor:'pointer', fontWeight:'bold'}}>{taxMode}</span></div><input type="number" value={receiptTax} onChange={e => setReceiptTax(e.target.value)} /></div>
               <div className="input-group" style={{flex:1}}><div style={{display:'flex', justifyContent:'space-between', marginBottom:'5px'}}><label>Tip</label><span onClick={()=>setTipMode(tipMode==='$'?'%':'$')} style={{color:'var(--primary)', cursor:'pointer', fontWeight:'bold'}}>{tipMode}</span></div><input type="number" value={receiptTip} onChange={e => setReceiptTip(e.target.value)} /></div>
            </div>
            <button className="btn btn-primary" style={{marginTop:'30px'}} onClick={saveReceiptToTrip}>{editingTripExpenseId ? "Save Changes" : "Save Receipt"}</button>
          </div>
        </div>
      )}
    </div>
  )
}

function calculateDebts(expenses) {
  const balances = {};
  expenses.forEach(exp => {
    const amount = exp.amount;
    const payer = exp.payer;
    const involved = exp.involved; 
    if (!amount || !payer || involved.length === 0) return;
    balances[payer] = (balances[payer] || 0) + amount;
    const splitAmount = amount / involved.length;
    involved.forEach(person => {
      balances[person] = (balances[person] || 0) - splitAmount;
    });
  });
  let debtors = [];
  let creditors = [];
  Object.entries(balances).forEach(([person, amount]) => {
    const net = Math.round(amount * 100) / 100;
    if (net < -0.01) debtors.push({ person, amount: net });
    if (net > 0.01) creditors.push({ person, amount: net });
  });
  debtors.sort((a, b) => a.amount - b.amount);
  creditors.sort((a, b) => b.amount - a.amount);
  const transactions = [];
  let i = 0; 
  let j = 0; 
  while (i < debtors.length && j < creditors.length) {
    const debtor = debtors[i];
    const creditor = creditors[j];
    const amount = Math.min(Math.abs(debtor.amount), creditor.amount);
    transactions.push(`${debtor.person} owes ${creditor.person} $${amount.toFixed(2)}`);
    debtor.amount += amount;
    creditor.amount -= amount;
    if (Math.abs(debtor.amount) < 0.01) i++;
    if (creditor.amount < 0.01) j++;
  }
  return transactions.length > 0 ? transactions : ["No debts found!"];
}

export default App