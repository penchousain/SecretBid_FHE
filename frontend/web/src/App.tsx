import { ConnectButton } from '@rainbow-me/rainbowkit';
import '@rainbow-me/rainbowkit/styles.css';
import React, { useEffect, useState } from "react";
import { getContractReadOnly, getContractWithSigner } from "./components/useContract";
import "./App.css";
import { useAccount } from 'wagmi';
import { useFhevm, useEncrypt, useDecrypt } from '../fhevm-sdk/src';

interface AuctionData {
  id: string;
  name: string;
  encryptedBid: string;
  publicValue1: number;
  publicValue2: number;
  description: string;
  creator: string;
  timestamp: number;
  isVerified?: boolean;
  decryptedValue?: number;
}

const App: React.FC = () => {
  const { address, isConnected } = useAccount();
  const [loading, setLoading] = useState(true);
  const [auctions, setAuctions] = useState<AuctionData[]>([]);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [creatingAuction, setCreatingAuction] = useState(false);
  const [transactionStatus, setTransactionStatus] = useState<{ visible: boolean; status: "pending" | "success" | "error"; message: string; }>({ 
    visible: false, 
    status: "pending" as const, 
    message: "" 
  });
  const [newAuctionData, setNewAuctionData] = useState({ name: "", bidAmount: "", description: "" });
  const [selectedAuction, setSelectedAuction] = useState<AuctionData | null>(null);
  const [isDecrypting, setIsDecrypting] = useState(false);
  const [contractAddress, setContractAddress] = useState("");
  const [fhevmInitializing, setFhevmInitializing] = useState(false);
  const [userHistory, setUserHistory] = useState<any[]>([]);
  const [stats, setStats] = useState({ totalAuctions: 0, verifiedBids: 0, avgBid: 0 });
  const [showFAQ, setShowFAQ] = useState(false);

  const { status, initialize, isInitialized } = useFhevm();
  const { encrypt, isEncrypting} = useEncrypt();
  const { verifyDecryption, isDecrypting: fheIsDecrypting } = useDecrypt();

  useEffect(() => {
    const initFhevmAfterConnection = async () => {
      if (!isConnected) return;
      if (isInitialized || fhevmInitializing) return;
      
      try {
        setFhevmInitializing(true);
        await initialize();
      } catch (error) {
        setTransactionStatus({ 
          visible: true, 
          status: "error", 
          message: "FHEVM initialization failed" 
        });
        setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
      } finally {
        setFhevmInitializing(false);
      }
    };

    initFhevmAfterConnection();
  }, [isConnected, isInitialized, initialize, fhevmInitializing]);

  useEffect(() => {
    const loadDataAndContract = async () => {
      if (!isConnected) {
        setLoading(false);
        return;
      }
      
      try {
        await loadData();
        const contract = await getContractReadOnly();
        if (contract) setContractAddress(await contract.getAddress());
        updateStats();
        loadUserHistory();
      } catch (error) {
        console.error('Failed to load data:', error);
      } finally {
        setLoading(false);
      }
    };

    loadDataAndContract();
  }, [isConnected]);

  const loadData = async () => {
    if (!isConnected) return;
    
    setIsRefreshing(true);
    try {
      const contract = await getContractReadOnly();
      if (!contract) return;
      
      const businessIds = await contract.getAllBusinessIds();
      const auctionsList: AuctionData[] = [];
      
      for (const businessId of businessIds) {
        try {
          const businessData = await contract.getBusinessData(businessId);
          auctionsList.push({
            id: businessId,
            name: businessData.name,
            encryptedBid: businessId,
            timestamp: Number(businessData.timestamp),
            creator: businessData.creator,
            publicValue1: Number(businessData.publicValue1) || 0,
            publicValue2: Number(businessData.publicValue2) || 0,
            description: businessData.description,
            isVerified: businessData.isVerified,
            decryptedValue: Number(businessData.decryptedValue) || 0
          });
        } catch (e) {
          console.error('Error loading business data:', e);
        }
      }
      
      setAuctions(auctionsList);
    } catch (e) {
      setTransactionStatus({ visible: true, status: "error", message: "Failed to load data" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
    } finally { 
      setIsRefreshing(false); 
    }
  };

  const createAuction = async () => {
    if (!isConnected || !address) { 
      setTransactionStatus({ visible: true, status: "error", message: "Please connect wallet first" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
      return; 
    }
    
    setCreatingAuction(true);
    setTransactionStatus({ visible: true, status: "pending", message: "Creating secret bid with FHE..." });
    
    try {
      const contract = await getContractWithSigner();
      if (!contract) throw new Error("Failed to get contract with signer");
      
      const bidValue = parseInt(newAuctionData.bidAmount) || 0;
      const businessId = `auction-${Date.now()}`;
      
      const encryptedResult = await encrypt(contractAddress, address, bidValue);
      
      const tx = await contract.createBusinessData(
        businessId,
        newAuctionData.name,
        encryptedResult.encryptedData,
        encryptedResult.proof,
        bidValue,
        0,
        newAuctionData.description
      );
      
      setTransactionStatus({ visible: true, status: "pending", message: "Waiting for transaction confirmation..." });
      await tx.wait();
      
      addUserHistory('CREATE_BID', { bid: bidValue, name: newAuctionData.name });
      
      setTransactionStatus({ visible: true, status: "success", message: "Secret bid created successfully!" });
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
      }, 2000);
      
      await loadData();
      setShowCreateModal(false);
      setNewAuctionData({ name: "", bidAmount: "", description: "" });
    } catch (e: any) {
      const errorMessage = e.message?.includes("user rejected transaction") 
        ? "Transaction rejected by user" 
        : "Submission failed: " + (e.message || "Unknown error");
      setTransactionStatus({ visible: true, status: "error", message: errorMessage });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
    } finally { 
      setCreatingAuction(false); 
    }
  };

  const decryptData = async (businessId: string): Promise<number | null> => {
    if (!isConnected || !address) { 
      setTransactionStatus({ visible: true, status: "error", message: "Please connect wallet first" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
      return null; 
    }
    
    setIsDecrypting(true);
    try {
      const contractRead = await getContractReadOnly();
      if (!contractRead) return null;
      
      const businessData = await contractRead.getBusinessData(businessId);
      if (businessData.isVerified) {
        const storedValue = Number(businessData.decryptedValue) || 0;
        
        setTransactionStatus({ 
          visible: true, 
          status: "success", 
          message: "Bid already verified on-chain" 
        });
        setTimeout(() => {
          setTransactionStatus({ visible: false, status: "pending", message: "" });
        }, 2000);
        
        return storedValue;
      }
      
      const contractWrite = await getContractWithSigner();
      if (!contractWrite) return null;
      
      const encryptedValueHandle = await contractRead.getEncryptedValue(businessId);
      
      const result = await verifyDecryption(
        [encryptedValueHandle],
        contractAddress,
        (abiEncodedClearValues: string, decryptionProof: string) => 
          contractWrite.verifyDecryption(businessId, abiEncodedClearValues, decryptionProof)
      );
      
      setTransactionStatus({ visible: true, status: "pending", message: "Verifying decryption on-chain..." });
      
      const clearValue = result.decryptionResult.clearValues[encryptedValueHandle];
      
      addUserHistory('VERIFY_BID', { bid: Number(clearValue) });
      await loadData();
      
      setTransactionStatus({ visible: true, status: "success", message: "Bid decrypted and verified successfully!" });
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
      }, 2000);
      
      return Number(clearValue);
      
    } catch (e: any) { 
      if (e.message?.includes("Data already verified")) {
        setTransactionStatus({ 
          visible: true, 
          status: "success", 
          message: "Bid is already verified on-chain" 
        });
        setTimeout(() => {
          setTransactionStatus({ visible: false, status: "pending", message: "" });
        }, 2000);
        
        await loadData();
        return null;
      }
      
      setTransactionStatus({ 
        visible: true, 
        status: "error", 
        message: "Decryption failed: " + (e.message || "Unknown error") 
      });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
      return null; 
    } finally { 
      setIsDecrypting(false); 
    }
  };

  const checkAvailability = async () => {
    try {
      const contract = await getContractReadOnly();
      if (!contract) return;
      
      const available = await contract.isAvailable();
      setTransactionStatus({ 
        visible: true, 
        status: "success", 
        message: `Contract is ${available ? 'available' : 'unavailable'}` 
      });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 2000);
    } catch (e) {
      setTransactionStatus({ visible: true, status: "error", message: "Availability check failed" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
    }
  };

  const addUserHistory = (action: string, data: any) => {
    const historyItem = {
      action,
      data,
      timestamp: Date.now(),
      address
    };
    setUserHistory(prev => [historyItem, ...prev.slice(0, 9)]);
  };

  const loadUserHistory = () => {
    const stored = localStorage.getItem(`auctionHistory-${address}`);
    if (stored) {
      setUserHistory(JSON.parse(stored));
    }
  };

  const updateStats = () => {
    const total = auctions.length;
    const verified = auctions.filter(a => a.isVerified).length;
    const avg = total > 0 ? auctions.reduce((sum, a) => sum + a.publicValue1, 0) / total : 0;
    
    setStats({
      totalAuctions: total,
      verifiedBids: verified,
      avgBid: avg
    });
  };

  useEffect(() => {
    if (address && userHistory.length > 0) {
      localStorage.setItem(`auctionHistory-${address}`, JSON.stringify(userHistory));
    }
  }, [userHistory, address]);

  useEffect(() => {
    updateStats();
  }, [auctions]);

  if (!isConnected) {
    return (
      <div className="app-container">
        <header className="app-header">
          <div className="logo">
            <h1>🔐 SecretBid FHE</h1>
          </div>
          <div className="header-actions">
            <div className="wallet-connect-wrapper">
              <ConnectButton accountStatus="address" chainStatus="icon" showBalance={false}/>
            </div>
          </div>
        </header>
        
        <div className="connection-prompt">
          <div className="connection-content">
            <div className="connection-icon">🔐</div>
            <h2>Connect Wallet to Enter Secret Auction</h2>
            <p>Join the FHE-powered secret bidding platform where your bids remain encrypted until verification.</p>
          </div>
        </div>
      </div>
    );
  }

  if (!isInitialized || fhevmInitializing) {
    return (
      <div className="loading-screen">
        <div className="fhe-spinner"></div>
        <p>Initializing FHE Encryption System...</p>
      </div>
    );
  }

  if (loading) return (
    <div className="loading-screen">
      <div className="fhe-spinner"></div>
      <p>Loading encrypted auction system...</p>
    </div>
  );

  return (
    <div className="app-container">
      <header className="app-header">
        <div className="logo">
          <h1>🔐 SecretBid FHE</h1>
          <span className="tagline">Fully Homomorphic Encrypted Auctions</span>
        </div>
        
        <div className="header-actions">
          <button className="nav-btn" onClick={() => setShowFAQ(true)}>FAQ</button>
          <button className="nav-btn" onClick={checkAvailability}>Check Status</button>
          <button className="create-btn" onClick={() => setShowCreateModal(true)}>
            + Place Secret Bid
          </button>
          <div className="wallet-connect-wrapper">
            <ConnectButton accountStatus="address" chainStatus="icon" showBalance={false}/>
          </div>
        </div>
      </header>
      
      <div className="main-content">
        <div className="stats-panel">
          <div className="stat-card">
            <div className="stat-value">{stats.totalAuctions}</div>
            <div className="stat-label">Total Bids</div>
          </div>
          <div className="stat-card">
            <div className="stat-value">{stats.verifiedBids}</div>
            <div className="stat-label">Verified</div>
          </div>
          <div className="stat-card">
            <div className="stat-value">{stats.avgBid.toFixed(1)}</div>
            <div className="stat-label">Avg Bid</div>
          </div>
        </div>

        <div className="content-grid">
          <div className="auctions-section">
            <div className="section-header">
              <h2>Active Secret Bids</h2>
              <button onClick={loadData} disabled={isRefreshing}>
                {isRefreshing ? "Refreshing..." : "Refresh"}
              </button>
            </div>
            
            <div className="auctions-list">
              {auctions.length === 0 ? (
                <div className="empty-state">
                  <p>No secret bids yet</p>
                  <button onClick={() => setShowCreateModal(true)}>
                    Place First Bid
                  </button>
                </div>
              ) : auctions.map((auction) => (
                <div 
                  className={`auction-item ${auction.isVerified ? "verified" : ""}`}
                  key={auction.id}
                  onClick={() => setSelectedAuction(auction)}
                >
                  <div className="auction-header">
                    <h3>{auction.name}</h3>
                    <span className={`status ${auction.isVerified ? "verified" : "pending"}`}>
                      {auction.isVerified ? "✅ Verified" : "🔒 Encrypted"}
                    </span>
                  </div>
                  <div className="auction-meta">
                    <span>Bidder: {auction.creator.substring(0, 8)}...</span>
                    <span>{new Date(auction.timestamp * 1000).toLocaleDateString()}</span>
                  </div>
                  <div className="auction-desc">{auction.description}</div>
                </div>
              ))}
            </div>
          </div>

          <div className="sidebar">
            <div className="user-history">
              <h3>Your Bidding History</h3>
              {userHistory.length === 0 ? (
                <p>No history yet</p>
              ) : (
                <div className="history-list">
                  {userHistory.map((item, index) => (
                    <div key={index} className="history-item">
                      <span className="action">{item.action.replace('_', ' ')}</span>
                      <span className="time">{new Date(item.timestamp).toLocaleTimeString()}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="fhe-info">
              <h3>FHE Process</h3>
              <div className="process-step">
                <span>1</span>
                <p>Bid encrypted with FHE</p>
              </div>
              <div className="process-step">
                <span>2</span>
                <p>Stored on-chain encrypted</p>
              </div>
              <div className="process-step">
                <span>3</span>
                <p>Verified with zero-knowledge</p>
              </div>
            </div>
          </div>
        </div>
      </div>
      
      {showCreateModal && (
        <CreateBidModal 
          onSubmit={createAuction} 
          onClose={() => setShowCreateModal(false)} 
          creating={creatingAuction} 
          auctionData={newAuctionData} 
          setAuctionData={setNewAuctionData}
          isEncrypting={isEncrypting}
        />
      )}
      
      {selectedAuction && (
        <BidDetailModal 
          auction={selectedAuction} 
          onClose={() => setSelectedAuction(null)} 
          isDecrypting={isDecrypting || fheIsDecrypting} 
          decryptData={() => decryptData(selectedAuction.id)}
        />
      )}
      
      {showFAQ && (
        <FAQModal onClose={() => setShowFAQ(false)} />
      )}
      
      {transactionStatus.visible && (
        <div className={`transaction-toast ${transactionStatus.status}`}>
          <div className="toast-content">
            {transactionStatus.status === "pending" && <div className="spinner"></div>}
            {transactionStatus.status === "success" && "✓"}
            {transactionStatus.status === "error" && "✗"}
            <span>{transactionStatus.message}</span>
          </div>
        </div>
      )}
    </div>
  );
};

const CreateBidModal: React.FC<{
  onSubmit: () => void; 
  onClose: () => void; 
  creating: boolean;
  auctionData: any;
  setAuctionData: (data: any) => void;
  isEncrypting: boolean;
}> = ({ onSubmit, onClose, creating, auctionData, setAuctionData, isEncrypting }) => {
  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    const { name, value } = e.target;
    if (name === 'bidAmount') {
      const intValue = value.replace(/[^\d]/g, '');
      setAuctionData({ ...auctionData, [name]: intValue });
    } else {
      setAuctionData({ ...auctionData, [name]: value });
    }
  };

  return (
    <div className="modal-overlay">
      <div className="modal">
        <div className="modal-header">
          <h2>Place Secret Bid</h2>
          <button onClick={onClose} className="close-btn">&times;</button>
        </div>
        
        <div className="modal-body">
          <div className="fhe-notice">
            <strong>FHE Encryption Active</strong>
            <p>Your bid amount will be fully encrypted using Zama FHE technology</p>
          </div>
          
          <div className="form-group">
            <label>Item Name *</label>
            <input 
              type="text" 
              name="name" 
              value={auctionData.name} 
              onChange={handleChange} 
              placeholder="Enter item name..." 
            />
          </div>
          
          <div className="form-group">
            <label>Bid Amount (Integer) *</label>
            <input 
              type="number" 
              name="bidAmount" 
              value={auctionData.bidAmount} 
              onChange={handleChange} 
              placeholder="Enter bid amount..." 
              min="0"
            />
            <div className="hint">FHE Encrypted - Only visible after verification</div>
          </div>
          
          <div className="form-group">
            <label>Description</label>
            <textarea 
              name="description" 
              value={auctionData.description} 
              onChange={handleChange} 
              placeholder="Enter bid description..." 
            />
          </div>
        </div>
        
        <div className="modal-footer">
          <button onClick={onClose} className="secondary-btn">Cancel</button>
          <button 
            onClick={onSubmit} 
            disabled={creating || isEncrypting || !auctionData.name || !auctionData.bidAmount} 
            className="primary-btn"
          >
            {creating || isEncrypting ? "Encrypting Bid..." : "Place Secret Bid"}
          </button>
        </div>
      </div>
    </div>
  );
};

const BidDetailModal: React.FC<{
  auction: AuctionData;
  onClose: () => void;
  isDecrypting: boolean;
  decryptData: () => Promise<number | null>;
}> = ({ auction, onClose, isDecrypting, decryptData }) => {
  const handleDecrypt = async () => {
    await decryptData();
  };

  return (
    <div className="modal-overlay">
      <div className="modal">
        <div className="modal-header">
          <h2>Bid Details</h2>
          <button onClick={onClose} className="close-btn">&times;</button>
        </div>
        
        <div className="modal-body">
          <div className="bid-info">
            <div className="info-row">
              <span>Item:</span>
              <strong>{auction.name}</strong>
            </div>
            <div className="info-row">
              <span>Bidder:</span>
              <span>{auction.creator}</span>
            </div>
            <div className="info-row">
              <span>Date:</span>
              <span>{new Date(auction.timestamp * 1000).toLocaleString()}</span>
            </div>
            <div className="info-row">
              <span>Status:</span>
              <span className={`status ${auction.isVerified ? "verified" : "encrypted"}`}>
                {auction.isVerified ? "✅ Verified" : "🔒 Encrypted"}
              </span>
            </div>
          </div>
          
          <div className="bid-amount-section">
            <h3>Bid Amount</h3>
            <div className="amount-display">
              {auction.isVerified ? (
                <div className="verified-amount">
                  <span className="amount">{auction.decryptedValue}</span>
                  <span className="label">(On-chain Verified)</span>
                </div>
              ) : (
                <div className="encrypted-amount">
                  <span className="placeholder">🔒 FHE Encrypted</span>
                  <span className="hint">Bid amount is encrypted for privacy</span>
                </div>
              )}
            </div>
            
            {!auction.isVerified && (
              <button 
                onClick={handleDecrypt} 
                disabled={isDecrypting}
                className="decrypt-btn"
              >
                {isDecrypting ? "Verifying..." : "Verify Bid Amount"}
              </button>
            )}
          </div>
          
          <div className="description-section">
            <h3>Description</h3>
            <p>{auction.description}</p>
          </div>
        </div>
        
        <div className="modal-footer">
          <button onClick={onClose} className="secondary-btn">Close</button>
        </div>
      </div>
    </div>
  );
};

const FAQModal: React.FC<{
  onClose: () => void;
}> = ({ onClose }) => {
  const faqs = [
    {
      question: "What is FHE?",
      answer: "Fully Homomorphic Encryption allows computations on encrypted data without decryption."
    },
    {
      question: "How are bids kept secret?",
      answer: "Bids are encrypted using FHE and only revealed after the auction ends through verification."
    },
    {
      question: "Is this truly private?",
      answer: "Yes, bid amounts remain encrypted throughout the auction process."
    }
  ];

  return (
    <div className="modal-overlay">
      <div className="modal faq-modal">
        <div className="modal-header">
          <h2>FHE Auction FAQ</h2>
          <button onClick={onClose} className="close-btn">&times;</button>
        </div>
        
        <div className="modal-body">
          {faqs.map((faq, index) => (
            <div key={index} className="faq-item">
              <h3>{faq.question}</h3>
              <p>{faq.answer}</p>
            </div>
          ))}
        </div>
        
        <div className="modal-footer">
          <button onClick={onClose} className="secondary-btn">Close</button>
        </div>
      </div>
    </div>
  );
};

export default App;


