import { useState, useEffect } from 'react'
import './App.css'

// --- FIREBASE IMPORTS ---
// Make sure you have created src/firebase.js with your config!
import { auth, googleProvider, db } from './firebase'
import { signInWithPopup, signOut, onAuthStateChanged } from 'firebase/auth'
import { doc, setDoc, onSnapshot } from 'firebase/firestore'

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

  // EDITING STATE
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
  
  // A. LISTEN to Database
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

  // B. WRITE to Database
  const saveToCloud = async (updatedTrips) => {
    setTrips(updatedTrips) // Update UI immediately
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

  // ==========================================
  // NAVIGATION ACTIONS
  // ==========================================
  const goHome = () => {
    setView('dashboard')
    setActiveTripId(null)
    setActiveLocation(null)
  }

  const openTrip = (id) => {
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
      expenses: []
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

  // --- REPLACED: SERVERLESS CALCULATION ---
  const calculateTripSettlement = () => {
    if (!activeTrip || activeTrip.expenses.length === 0) return;
    
    setIsLoading(true);
    
    // Simulate a tiny delay so the user sees something happening
    setTimeout(() => {
      // Calls the helper function defined at the bottom of this file
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
      <div className="app-container" style={{display:'flex', justifyContent:'center', alignItems:'center', height:'80vh'}}>
         <div className="card" style={{maxWidth:'400px', textAlign:'center'}}>
            <h1 className="hero-title" style={{fontSize:'3rem'}}>GroupTab</h1>
            <p className="hero-subtitle" style={{opacity:1, fontSize:'1rem'}}>Login to save your trips to the cloud.</p>
            <button className="btn btn-primary" onClick={handleGoogleLogin} style={{marginTop:'30px'}}>
               Sign in with Google
            </button>
         </div>
      </div>
    )
  }

  return (
    <div className="app-container">
      
      {/* HEADER */}
      <div style={{marginBottom:'20px', borderBottom:'1px solid #333', paddingBottom:'10px', display:'flex', justifyContent:'space-between', alignItems:'center'}}>
        <div style={{display:'flex', alignItems:'center', gap:'15px'}}>
           <h2 style={{margin:0, cursor:'pointer'}} onClick={goHome}>GroupTab 📁</h2>
           <span style={{fontSize:'0.8rem', color:'#888'}}>Hi, {user.displayName ? user.displayName.split(' ')[0] : 'User'}</span>
        </div>
        
        <div style={{display:'flex', gap:'10px'}}>
           {view !== 'dashboard' && <button className="back-btn" onClick={goHome}>Home</button>}
           <button className="back-btn" style={{color:'#ff5252'}} onClick={handleLogout}>Logout</button>
        </div>
      </div>
      
      {/* ---------------- VIEW 1: DASHBOARD ---------------- */}
      {view === 'dashboard' && (
        <div className="dashboard-centered">
          <div className="hero-container">
            <h1 className="hero-title">GroupTab</h1>
            <p className="hero-subtitle">Welcome back! Track expenses, split bills, and travel stress-free.</p>
          </div>
          <div className="create-card-wrapper card">
            <h3 style={{marginTop:0}}>Create New Trip</h3>
            <div style={{display:'flex', gap:'10px'}}>
              <input placeholder="Trip Name (e.g. Orlando 2025)" value={newFolderName} onChange={e => setNewFolderName(e.target.value)} />
              <button className="btn btn-primary" style={{width:'auto'}} onClick={createFolder}>Create</button>
            </div>
          </div>
          {trips.length > 0 && (
            <div style={{width:'100%', marginTop:'40px'}}>
              <h4 style={{color:'#666', borderBottom:'1px solid #333', paddingBottom:'10px', textAlign:'center'}}>Your Trips</h4>
              <div className="folder-grid">
                {trips.map(trip => (
                  <div key={trip.id} className="folder-card" onClick={() => openTrip(trip.id)}>
                    <span className="folder-icon">✈️</span>
                    <div className="folder-name">{trip.name}</div>
                    <div className="folder-meta">{trip.expenses.length} items</div>
                    <button className="delete-btn" style={{position:'absolute', top:'5px', right:'5px', padding:'5px'}} onClick={(e) => deleteFolder(e, trip.id)}>✕</button>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* ---------------- VIEW 2: TRIP OVERVIEW ---------------- */}
      {view === 'trip_view' && activeTrip && (
        <div>
          <h1 className="header-title">{activeTrip.name}</h1>
          <div className="layout-grid">
            
            {/* LEFT: RECEIPT TABS */}
            <div>
              <div style={{display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:'15px'}}>
                 <h2 style={{margin:0}}>Receipts</h2>
                 <button className="btn btn-primary" style={{width:'auto', padding:'8px 15px'}} onClick={openReceiptBuilder}>+ Add New</button>
              </div>
              {tripLocations.length === 0 && <div style={{color:'#666', padding:'20px', border:'1px dashed #444', borderRadius:'10px'}}>No receipts yet.</div>}
              <div className="folder-grid" style={{gridTemplateColumns:'repeat(auto-fit, minmax(150px, 1fr))'}}>
                {tripLocations.map(loc => (
                  <div key={loc} className="folder-card" style={{padding:'20px'}} onClick={() => openLocationTab(loc)}>
                    <span style={{fontSize:'2rem'}}>🧾</span>
                    <div style={{fontWeight:'bold', marginTop:'5px'}}>{loc}</div>
                  </div>
                ))}
              </div>
            </div>

            {/* RIGHT: TRIP CALCULATIONS & BREAKDOWN */}
            <div>
               {/* 1. FINAL SETTLEMENT CARD */}
               <div className="card">
                 <h2 style={{marginTop:0}}>Final Settlement</h2>
                 <p style={{fontSize:'0.9rem', color:'#aaa'}}>Calculates net debts across ALL receipts (Deducts who paid what).</p>
                 <button className="btn btn-primary" onClick={calculateTripSettlement} disabled={isLoading || activeTrip.expenses.length === 0}>
                   {isLoading ? 'Calculating...' : 'Calculate Who Owes Who'}
                 </button>
               </div>

               {/* 2. RESULTS DISPLAY */}
               {results.length > 0 && (
                 <div className="card settlement-card">
                   <h2 style={{marginTop:0, color:'#4caf50'}}>Who Owes Who?</h2>
                   {results.map((line, idx) => <div key={idx} className="settlement-row">✅ {line}</div>)}
                 </div>
               )}

               {/* 3. MASTER TRIP BREAKDOWN */}
               {activeTrip.expenses.length > 0 && (
                 <div style={{marginTop:'30px'}}>
                    <h3 style={{marginBottom:'15px', paddingLeft:'10px'}}>Total Trip Breakdown</h3>
                    <div className="breakdown-grid"> 
                      {Object.entries(getBreakdown(activeTrip.expenses)).map(([person, data]) => (
                        <div key={person} className="spreadsheet-card">
                          <div className="spreadsheet-header">{person}</div>
                          <div className="spreadsheet-body">
                            {data.items.map((i, idx) => (
                               <div key={idx} className="line-item">
                                 <span>{i.name} <span style={{fontSize:'0.7rem', color:'#888'}}>({i.location})</span></span>
                                 <span>{i.cost.toFixed(2)}</span>
                               </div>
                            ))}
                          </div>
                          <div className="spreadsheet-footer">
                             <div className="summary-row"><span>Subtotal</span><span>{data.subtotal.toFixed(2)}</span></div>
                             <div className="summary-row"><span>Tax/Tip</span><span>{(data.tax + data.tip).toFixed(2)}</span></div>
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
          
          <h1 className="header-title">{activeLocation} <span style={{fontSize:'0.5em', opacity:0.5}}>Receipt</span></h1>
          
          <div className="layout-grid">
            
            {/* LEFT COLUMN: ITEMS (Vertical List) */}
            <div className="card">
              <h3 style={{marginTop:0}}>Receipt Items</h3>
              
              <div className="items-grid">
                {locationExpenses.map(exp => (
                  <div key={exp.id} className="expense-box">
                    <div>
                      <div style={{fontWeight:'bold', fontSize:'1rem'}}>{exp.item}</div>
                      <div style={{fontSize:'0.8rem', color:'#888'}}>
                        Shared by: <span style={{color:'#ccc'}}>{exp.involved.join(', ')}</span>
                      </div>
                    </div>

                    <div className="expense-box-footer">
                       <span style={{color:'#4caf50', fontWeight:'bold', fontSize:'1.1rem'}}>${exp.amount.toFixed(2)}</span>
                       <div style={{display:'flex', gap:'10px'}}>
                          <span style={{cursor:'pointer', fontSize:'1.2rem'}} onClick={() => editSavedExpense(exp)}>✎</span>
                          <span style={{cursor:'pointer', fontSize:'1.2rem', color:'#ff5252'}} onClick={() => deleteExpense(exp.id)}>✕</span>
                       </div>
                    </div>
                  </div>
                ))}
                {locationExpenses.length === 0 && <div style={{color:'#666', textAlign:'center', fontStyle:'italic', padding:'20px'}}>No items added yet.</div>}
              </div>
            </div>

            {/* RIGHT COLUMN: BREAKDOWN (Horizontal Cards) */}
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
                       <div className="summary-row"><span>Tax/Tip</span><span>{(data.tax + data.tip).toFixed(2)}</span></div>
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
            <h2 style={{marginTop:0, color:'#80caff'}}>
              {editingTripExpenseId ? `Edit Item in ${receiptLoc}` : "New Receipt"}
            </h2>
            
            <div className="input-row" style={{display:'flex', gap:'15px'}}>
               <div className="input-group" style={{flex:1}}>
                 <label>Location</label>
                 <input placeholder="e.g. Cowfish" value={receiptLoc} onChange={e => setReceiptLoc(e.target.value)} />
               </div>
               <div className="input-group" style={{flex:1}}>
                 <label>Payer</label>
                 <input placeholder="e.g. Ashton" value={receiptPayer} onChange={e => setReceiptPayer(e.target.value)} />
               </div>
            </div>

            <div style={{background:'rgba(255,255,255,0.05)', padding:'15px', borderRadius:'10px', marginBottom:'20px', border: editingIndex !== null ? '1px solid #4caf50' : 'none'}}>
               <div className="input-row" style={{display:'flex', gap:'10px'}}>
                  <div style={{flex:0.8}}><label style={{fontSize:'0.7rem'}}>Qty</label><input type="number" value={quantity} onChange={e => setQuantity(e.target.value)} style={{textAlign:'center'}}/></div>
                  <div style={{flex:2}}><label style={{fontSize:'0.7rem'}}>Item</label><input placeholder="Item" value={itemName} onChange={e => setItemName(e.target.value)} /></div>
                  <div style={{flex:1.2}}><label style={{fontSize:'0.7rem'}}>Price</label><input type="number" placeholder="0.00" value={unitPrice} onChange={e => setUnitPrice(e.target.value)} /></div>
               </div>
               <div className="input-group" style={{marginTop:'10px'}}>
                 <input placeholder="Consumers (e.g. Ashton, Bob)" value={itemConsumer} onChange={e => setItemConsumer(e.target.value)} />
               </div>
               <div style={{marginTop:'10px', display:'flex', gap:'10px'}}>
                  <button className="btn btn-primary" style={{padding:'10px', fontSize:'0.9rem', background: editingIndex!==null?'#4caf50':''}} onClick={handleAddOrUpdateItem}>
                    {editingIndex!==null ? 'Update Item' : '+ Add Item'}
                  </button>
               </div>
            </div>

            {currentItems.length > 0 && (
              <ul style={{paddingLeft:0, listStyle:'none', marginBottom:'20px'}}>
                {currentItems.map((item, idx) => (
                  <li key={idx} style={{background:'rgba(255,255,255,0.05)', padding:'10px', marginBottom:'5px', borderRadius:'8px', display:'flex', justifyContent:'space-between'}}>
                    <div>{item.qty}x {item.name} (${item.totalPrice.toFixed(2)})</div>
                    <div style={{cursor:'pointer'}} onClick={()=>startEditingDraftItem(idx)}>✎</div>
                  </li>
                ))}
              </ul>
            )}

            <div className="input-row" style={{display:'flex', gap:'15px'}}>
               <div className="input-group" style={{flex:1}}>
                  <div style={{display:'flex', justifyContent:'space-between'}}><label>Tax</label><span onClick={()=>setTaxMode(taxMode==='$'?'%':'$')} style={{color:'#80caff', cursor:'pointer'}}>{taxMode}</span></div>
                  <input type="number" value={receiptTax} onChange={e => setReceiptTax(e.target.value)} />
               </div>
               <div className="input-group" style={{flex:1}}>
                  <div style={{display:'flex', justifyContent:'space-between'}}><label>Tip</label><span onClick={()=>setTipMode(tipMode==='$'?'%':'$')} style={{color:'#80caff', cursor:'pointer'}}>{tipMode}</span></div>
                  <input type="number" value={receiptTip} onChange={e => setReceiptTip(e.target.value)} />
               </div>
            </div>

            <button className="btn btn-primary" style={{marginTop:'20px'}} onClick={saveReceiptToTrip}>
              {editingTripExpenseId ? "Save Changes" : "Save Receipt"}
            </button>
          </div>
        </div>
      )}

    </div>
  )
}

// ============================================
// SERVERLESS ALGORITHM (REPLACES PYTHON BACKEND)
// ============================================
function calculateDebts(expenses) {
  const balances = {};

  // 1. Calculate Net Balances
  expenses.forEach(exp => {
    const amount = exp.amount;
    const payer = exp.payer;
    const involved = exp.involved; // Array of names
    
    if (!amount || !payer || involved.length === 0) return;

    // Payer gets positive balance (they are owed money)
    balances[payer] = (balances[payer] || 0) + amount;

    // Consumers get negative balance (they owe money)
    const splitAmount = amount / involved.length;
    involved.forEach(person => {
      balances[person] = (balances[person] || 0) - splitAmount;
    });
  });

  // 2. Separate into Debtors and Creditors
  let debtors = [];
  let creditors = [];

  Object.entries(balances).forEach(([person, amount]) => {
    // Round to 2 decimals to avoid floating point errors
    const net = Math.round(amount * 100) / 100;
    if (net < -0.01) debtors.push({ person, amount: net });
    if (net > 0.01) creditors.push({ person, amount: net });
  });

  // Sort by magnitude to optimize matching
  debtors.sort((a, b) => a.amount - b.amount);
  creditors.sort((a, b) => b.amount - a.amount);

  // 3. Match them up
  const transactions = [];
  let i = 0; // Iterator for debtors
  let j = 0; // Iterator for creditors

  while (i < debtors.length && j < creditors.length) {
    const debtor = debtors[i];
    const creditor = creditors[j];

    // The amount to settle is the minimum of what's owed vs what's owed TO
    const amount = Math.min(Math.abs(debtor.amount), creditor.amount);

    // Record the transaction
    transactions.push(`${debtor.person} owes ${creditor.person} $${amount.toFixed(2)}`);

    // Adjust remaining balances
    debtor.amount += amount;
    creditor.amount -= amount;

    // If fully settled, move to next person
    if (Math.abs(debtor.amount) < 0.01) i++;
    if (creditor.amount < 0.01) j++;
  }

  return transactions.length > 0 ? transactions : ["No debts found!"];
}

export default App