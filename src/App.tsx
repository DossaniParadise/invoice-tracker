/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useMemo, useRef } from 'react';
import * as pdfjsLib from 'pdfjs-dist';
import pdfWorker from 'pdfjs-dist/build/pdf.worker.mjs?url';

// Set up PDF.js worker
pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorker;
import { 
  LayoutDashboard, 
  Upload, 
  Bell, 
  BarChart3, 
  ChevronRight, 
  CheckCircle2, 
  XCircle, 
  Clock, 
  PauseCircle, 
  RotateCcw, 
  FileText, 
  Search, 
  Filter, 
  MoreVertical,
  ArrowLeft,
  Send,
  Download,
  Copy,
  Trash2,
  User as UserIcon
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { USERS, STORES } from './constants';
import { 
  Invoice, 
  User, 
  Store, 
  Status, 
  Role, 
  ApprovalStep, 
  ApprovalCycle, 
  Comment 
} from './types';
import { invoiceService } from './services/invoiceService';
import { supabase } from './lib/supabase';

// --- Helper Functions ---
const fmtAmt = (n: number) => new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n);
const fmtDate = (d: string) => {
  if (!d) return '—';
  const [y, m, day] = d.split('-');
  return `${m}/${day}/${y.slice(2)}`;
};
const fmtTs = (ts: number) => {
  if (!ts) return '—';
  return new Date(ts).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
};
const timeAgo = (ts: number) => {
  if (!ts) return '';
  const diff = Date.now() - ts;
  const m = Math.floor(diff / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return m + 'm ago';
  const h = Math.floor(m / 60);
  if (h < 24) return h + 'h ago';
  return Math.floor(h / 24) + 'd ago';
};

const buildApprovalChain = (store: Store, amount: number): ApprovalStep[] => {
  const steps: ApprovalStep[] = [];
  const hasNoAC = !store.acId;

  if (hasNoAC) {
    if (amount <= 1000) {
      steps.push({ role: 'DIRECTOR', label: 'Director', userId: store.directorId, name: USERS[store.directorId].name, note: '≤ $1,000 — Director only' });
    } else {
      steps.push({ role: 'DIRECTOR', label: 'Director', userId: store.directorId, name: USERS[store.directorId].name });
      if (amount <= 4999) {
        steps.push({ role: 'VP', label: 'VP', userId: 'sam', name: 'Sam' });
      } else {
        steps.push({ role: 'VP', label: 'VP', userId: 'sam', name: 'Sam' });
        steps.push({ role: 'COO', label: 'COO', userId: 'armaan', name: 'Armaan' });
      }
    }
  } else {
    steps.push({ role: 'AREA_COACH', label: 'Area Coach', userId: store.acId!, name: USERS[store.acId!].name });
    if (amount >= 501) {
      steps.push({ role: 'DIRECTOR', label: 'Director', userId: store.directorId, name: USERS[store.directorId].name });
    }
    if (amount >= 1001) {
      steps.push({ role: 'VP', label: 'VP', userId: 'sam', name: 'Sam' });
    }
    if (amount >= 5000) {
      steps.push({ role: 'COO', label: 'COO', userId: 'armaan', name: 'Armaan' });
    }
  }
  return steps;
};

const canUserAct = (user: User, invoice: Invoice): boolean => {
  if (invoice.status === 'PAID' || invoice.status === 'APPROVED') return false;
  
  // Special case: AP Supervisor can act on anything if it's at their stage
  if (user.role === 'AP_SUPERVISOR' && invoice.currentStage === 'AP_SUPERVISOR') return true;
  
  // Otherwise, must be the current stage and the assigned user
  return invoice.currentStage === user.role && (
    invoice.acId === user.id || 
    invoice.directorId === user.id ||
    (invoice.currentStage === 'VP' && user.id === 'sam') ||
    (invoice.currentStage === 'COO' && user.id === 'armaan') ||
    (invoice.currentStage === 'AP_SUPERVISOR' && user.id === 'anila') ||
    (invoice.currentStage === 'AP_COORDINATOR' && user.id === 'kathreen')
  );
};

const canUserMarkAsPaid = (user: User, invoice: Invoice): boolean => {
  if (invoice.status !== 'APPROVED') return false;
  const allowedRoles: Role[] = ['AP_COORDINATOR', 'AP_SUPERVISOR', 'ACCOUNTING', 'FINANCE_MANAGER'];
  return allowedRoles.includes(user.role) || user.id === 'it';
};

const getStoreLogo = (storeName: string) => {
  const n = storeName.toLowerCase();
  if (n.includes('burger king')) return 'https://raw.githubusercontent.com/DossaniParadise/invoice-tracker/main/logos/bk-logo.png';
  if (n.includes('subway'))      return 'https://raw.githubusercontent.com/DossaniParadise/invoice-tracker/main/logos/subway-logo.png';
  if (n.includes('7-eleven'))    return 'https://raw.githubusercontent.com/DossaniParadise/invoice-tracker/main/logos/711-logo.png';
  if (n.includes('paradise quick stop')) return 'https://raw.githubusercontent.com/DossaniParadise/invoice-tracker/main/logos/pqs-logo.png';
  if (n.includes('scarborough')) return 'https://raw.githubusercontent.com/DossaniParadise/invoice-tracker/main/logos/cw-logo.png';
  if (n.includes('nashville'))   return 'https://raw.githubusercontent.com/DossaniParadise/invoice-tracker/main/logos/dpm-logo.png';
  return 'https://raw.githubusercontent.com/DossaniParadise/invoice-tracker/main/logos/dpm-icon.png';
};

// --- Components ---

export default function App() {
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const [loginFirstName, setLoginFirstName] = useState('');
  const [loginLastName, setLoginLastName] = useState('');
  const [loginError, setLoginError] = useState('');
  
  const [page, setPage] = useState<'dashboard' | 'upload' | 'notifications' | 'reports'>('dashboard');
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [notifications, setNotifications] = useState<any[]>([]);
  const [activeInvoice, setActiveInvoice] = useState<Invoice | null>(null);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [pdfPreviewUrl, setPdfPreviewUrl] = useState<string | null>(null);
  const [newComment, setNewComment] = useState('');
  const [isAddingComment, setIsAddingComment] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const multiFileInputRef = useRef<HTMLInputElement>(null);
  
  // Multi-upload state
  const [pendingUploads, setPendingUploads] = useState<any[]>([]);
  const [isMultiUploadMode, setIsMultiUploadMode] = useState(false);
  const [statusFilter, setStatusFilter] = useState<string>('');
  const [divisionFilter, setDivisionFilter] = useState<string>('');
  const [regionFilter, setRegionFilter] = useState<string>('');
  const [storeFilter, setStoreFilter] = useState<string>('');
  const [approverFilter, setApproverFilter] = useState<string>('');
  const [searchFilter, setSearchFilter] = useState<string>('');
  const [amountFilter, setAmountFilter] = useState<string>('');
  const [selectedAction, setSelectedAction] = useState<'APPROVED' | 'DENIED' | 'HOLD' | null>(null);
  const [isReminderModalOpen, setIsReminderModalOpen] = useState(false);
  const [reminderUserId, setReminderUserId] = useState<string>('');
  const [isChangePasswordModalOpen, setIsChangePasswordModalOpen] = useState(false);
  const [newPassword, setNewPassword] = useState('');
  const [isSupabaseConfigured, setIsSupabaseConfigured] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);

  // Upload Form State
  const [uploadStoreId, setUploadStoreId] = useState('');
  const [uploadVendor, setUploadVendor] = useState('');
  const [uploadDate, setUploadDate] = useState(new Date().toISOString().slice(0, 10));
  const [uploadAmount, setUploadAmount] = useState('');
  const [uploadInvNum, setUploadInvNum] = useState('');
  const [uploadPoNum, setUploadPoNum] = useState('');

  const currentUser = currentUserId ? USERS[currentUserId] : null;

  useEffect(() => {
    const savedUser = localStorage.getItem('ap_tracker_user');
    if (savedUser && USERS[savedUser]) {
      setCurrentUserId(savedUser);
    }

    const configured = !!supabase;
    setIsSupabaseConfigured(configured);
    
    if (configured) {
      loadInvoices();
      const subscription = invoiceService.subscribeToInvoices(() => {
        loadInvoices();
      });
      return () => {
        subscription.unsubscribe();
      };
    } else {
      seedInvoices();
      setIsLoading(false);
    }
  }, []);

  const loadInvoices = async () => {
    try {
      setIsLoading(true);
      const data = await invoiceService.getInvoices();
      setInvoices(data);
    } catch (err) {
      console.error('Failed to load invoices from Supabase:', err);
      seedInvoices();
    } finally {
      setIsLoading(false);
    }
  };

  const seedInvoices = () => {
    setInvoices([]);
    setNotifications([]);
  };

  const visibleStores = useMemo(() => {
    if (!currentUser) return [];
    if (currentUser.role === 'AREA_COACH') return STORES.filter(s => s.acId === currentUser.id);
    if (currentUser.role === 'DIRECTOR') return STORES.filter(s => s.division === currentUser.division);
    return STORES;
  }, [currentUser]);

  const filteredInvoices = useMemo(() => {
    if (!currentUser) return [];
    let inv = [...invoices];
    
    // Permission filter
    if (currentUser.role === 'AREA_COACH') inv = inv.filter(i => i.acId === currentUser.id);
    else if (currentUser.role === 'DIRECTOR') inv = inv.filter(i => i.division === currentUser.division);
    
    // UI filters
    if (statusFilter) inv = inv.filter(i => i.status === statusFilter);
    if (divisionFilter) inv = inv.filter(i => i.division === divisionFilter);
    if (regionFilter) inv = inv.filter(i => i.region === regionFilter);
    if (storeFilter) inv = inv.filter(i => i.storeId === storeFilter);
    if (approverFilter) {
      inv = inv.filter(i => {
        const currentStep = i.requiredApprovals.find(s => s.role === i.currentStage);
        return currentStep?.userId === approverFilter;
      });
    }
    if (amountFilter) {
      if (amountFilter === '5000+') inv = inv.filter(i => i.amount >= 5000);
      else {
        const [lo, hi] = amountFilter.split('-').map(Number);
        inv = inv.filter(i => i.amount >= lo && i.amount <= hi);
      }
    }
    if (searchFilter) {
      const q = searchFilter.toLowerCase();
      inv = inv.filter(i => 
        i.vendor.toLowerCase().includes(q) || 
        i.invoiceNumber.toLowerCase().includes(q) || 
        i.id.toLowerCase().includes(q)
      );
    }
    
    return inv.sort((a, b) => b.createdAt - a.createdAt);
  }, [invoices, currentUser, statusFilter, divisionFilter, regionFilter, storeFilter, approverFilter, amountFilter, searchFilter]);

  const uniqueVendors = useMemo(() => {
    const vendors = new Set<string>();
    invoices.forEach(inv => {
      if (inv.vendor) vendors.add(inv.vendor);
    });
    return Array.from(vendors).sort();
  }, [invoices]);

  const previewApprovalChain = useMemo(() => {
    if (!uploadStoreId || !uploadAmount) return [];
    const store = STORES.find(s => s.id === uploadStoreId);
    if (!store) return [];
    return buildApprovalChain(store, parseFloat(uploadAmount) || 0);
  }, [uploadStoreId, uploadAmount]);

  const stats = useMemo(() => {
    // Use base invoices (after user-level filtering) for stats, not filteredInvoices
    const baseInvoices = invoices.filter(inv => {
      if (!currentUser) return false;
      if (currentUser.id === 'it' || currentUser.role === 'AP_SUPERVISOR' || currentUser.role === 'AP_COORDINATOR' || currentUser.role === 'ACCOUNTING' || currentUser.role === 'FINANCE_MANAGER' || currentUser.role === 'COO' || currentUser.role === 'VP') return true;
      if (currentUser.role === 'AREA_COACH') return inv.acId === currentUser.id;
      if (currentUser.role === 'DIRECTOR') return inv.division === currentUser.division;
      return false;
    });

    const counts = { PENDING: 0, APPROVED: 0, HOLD: 0, DENIED: 0, PAID: 0 };
    let paidTotal = 0;
    baseInvoices.forEach(i => {
      counts[i.status]++;
      if (i.status === 'PAID') paidTotal += i.amount;
    });
    return { counts, paidTotal, total: baseInvoices.length };
  }, [invoices, currentUser]);

  const handleAction = async (type: 'APPROVED' | 'DENIED' | 'HOLD' | 'PUSH_BACK' | 'PAID', comment: string, invoiceToUpdate?: Invoice) => {
    const targetInvoice = invoiceToUpdate || activeInvoice;
    if (!targetInvoice || !currentUser) return;
    
    const now = Date.now();
    const updatedInvoice = { ...targetInvoice };
    
    if (type === 'PAID') {
      updatedInvoice.status = 'PAID';
      updatedInvoice.paidAt = now;
      updatedInvoice.currentStage = 'PAID';
    } else {
      const currentCycle = updatedInvoice.approvalCycles[updatedInvoice.approvalCycles.length - 1];
      currentCycle.steps.push({
        stage: updatedInvoice.currentStage as Role,
        userId: currentUser.id,
        action: type,
        ts: now,
        comment
      });
      
      if (type === 'APPROVED') {
        const chain = updatedInvoice.requiredApprovals;
        const idx = chain.findIndex(s => s.role === updatedInvoice.currentStage);
        if (idx === chain.length - 1) {
          updatedInvoice.status = 'APPROVED';
          updatedInvoice.currentStage = 'APPROVED';
        } else {
          updatedInvoice.currentStage = chain[idx + 1].role;
        }
      } else if (type === 'DENIED') {
        updatedInvoice.status = 'DENIED';
      } else if (type === 'HOLD') {
        updatedInvoice.status = 'HOLD';
      }
    }
    
    updatedInvoice.updatedAt = now;

    if (isSupabaseConfigured) {
      try {
        await invoiceService.updateInvoice(updatedInvoice.id, updatedInvoice);
      } catch (err) {
        console.error('Failed to update invoice in Supabase:', err);
      }
    } else {
      setInvoices(prev => prev.map(i => i.id === updatedInvoice.id ? updatedInvoice : i));
    }
    
    if (activeInvoice && activeInvoice.id === updatedInvoice.id) {
      setActiveInvoice(updatedInvoice);
    }
    setSelectedAction(null);
    setNewComment('');
  };

  const handleRevoke = async () => {
    if (!activeInvoice || !currentUser) return;
    
    const updatedInvoice = { ...activeInvoice };
    const currentCycle = updatedInvoice.approvalCycles[updatedInvoice.approvalCycles.length - 1];
    
    const lastStepIdx = [...currentCycle.steps].reverse().findIndex(s => s.userId === currentUser.id && s.action === 'APPROVED');
    
    if (lastStepIdx === -1) return;
    
    const actualIdx = currentCycle.steps.length - 1 - lastStepIdx;
    const revokedStep = currentCycle.steps[actualIdx];
    
    currentCycle.steps.splice(actualIdx, 1);
    
    updatedInvoice.status = 'PENDING';
    updatedInvoice.currentStage = revokedStep.stage;
    updatedInvoice.updatedAt = Date.now();

    if (isSupabaseConfigured) {
      try {
        await invoiceService.updateInvoice(updatedInvoice.id, updatedInvoice);
      } catch (err) {
        console.error('Failed to update invoice in Supabase:', err);
      }
    } else {
      setInvoices(prev => prev.map(i => i.id === updatedInvoice.id ? updatedInvoice : i));
    }
    
    setActiveInvoice(updatedInvoice);
  };

  const handleDeleteInvoice = async () => {
    if (!activeInvoice || !currentUser) return;
    
    setIsDeleting(true);
    try {
      if (isSupabaseConfigured) {
        await invoiceService.deleteInvoice(activeInvoice.id);
      } else {
        setInvoices(prev => prev.filter(i => i.id !== activeInvoice.id));
      }
      setActiveInvoice(null);
      setShowDeleteConfirm(false);
    } catch (err) {
      console.error('Failed to delete invoice:', err);
      alert('Failed to delete invoice. Please check your permissions.');
    } finally {
      setIsDeleting(false);
    }
  };

  const handleAddComment = async () => {
    if (!activeInvoice || !currentUser || !newComment.trim() || isAddingComment) return;

    setIsAddingComment(true);
    const now = Date.now();
    const commentObj: Comment = {
      id: `CMT-${now}`,
      userId: currentUser.id,
      text: newComment.trim(),
      mentions: [],
      ts: now
    };

    const updatedInvoice = {
      ...activeInvoice,
      comments: [...(activeInvoice.comments || []), commentObj],
      updatedAt: now
    };

    if (isSupabaseConfigured) {
      try {
        await invoiceService.updateInvoice(updatedInvoice.id, updatedInvoice);
        setNewComment('');
      } catch (err) {
        console.error('Failed to add comment in Supabase:', err);
        alert('Failed to save comment.');
      }
    } else {
      setInvoices(prev => prev.map(i => i.id === updatedInvoice.id ? updatedInvoice : i));
      setNewComment('');
    }
    
    setActiveInvoice(updatedInvoice);
    setIsAddingComment(false);
  };

  const generatePdfPreview = async (file: File) => {
    try {
      const arrayBuffer = await file.arrayBuffer();
      const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
      const page = await pdf.getPage(1);
      
      const viewport = page.getViewport({ scale: 2.0 });
      const canvas = document.createElement('canvas');
      const context = canvas.getContext('2d');
      
      if (!context) return;
      
      canvas.height = viewport.height;
      canvas.width = viewport.width;
      
      await page.render({
        canvasContext: context,
        viewport: viewport,
        canvas: canvas
      }).promise;
      
      setPdfPreviewUrl(canvas.toDataURL());
    } catch (err: any) {
      console.error('Error generating PDF preview:', err.message || err);
      setPdfPreviewUrl(null);
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files) return;

    if (files.length > 1 || isMultiUploadMode) {
      handleMultipleFiles(Array.from(files) as File[]);
    } else {
      const file = files[0];
      if (file && file.type === 'application/pdf') {
        setSelectedFile(file);
        generatePdfPreview(file);
      } else if (file) {
        alert('Please select a PDF file');
      }
    }
  };

  const handleMultipleFiles = async (files: File[]) => {
    const pdfFiles = files.filter(f => f.type === 'application/pdf');
    if (pdfFiles.length === 0) {
      alert('No PDF files found');
      return;
    }

    setIsMultiUploadMode(true);
    const newPending = await Promise.all(pdfFiles.map(async (file) => {
      // Generate a quick preview for each if possible, or just use a placeholder
      return {
        id: Math.random().toString(36).substr(2, 9),
        file,
        vendor: '',
        amount: '',
        date: new Date().toISOString().slice(0, 10),
        invoiceNumber: '',
        poNumber: '',
        storeId: '',
        status: 'idle' as 'idle' | 'uploading' | 'success' | 'error',
        error: ''
      };
    }));

    setPendingUploads(prev => [...prev, ...newPending]);
    setPage('upload');
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    const files = Array.from(e.dataTransfer.files) as File[];
    if (files.length > 1 || isMultiUploadMode) {
      handleMultipleFiles(files);
    } else {
      const file = files[0];
      if (file && file.type === 'application/pdf') {
        setSelectedFile(file);
        generatePdfPreview(file);
      } else if (file) {
        alert('Please drop a PDF file');
      }
    }
  };

  const handleUpdatePendingUpload = (id: string, updates: any) => {
    setPendingUploads(prev => prev.map(u => u.id === id ? { ...u, ...updates } : u));
  };

  const handleRemovePendingUpload = (id: string) => {
    setPendingUploads(prev => {
      const filtered = prev.filter(u => u.id !== id);
      if (filtered.length === 0) setIsMultiUploadMode(false);
      return filtered;
    });
  };

  const handleBulkUpload = async () => {
    const validUploads = pendingUploads.filter(u => u.status !== 'success');
    if (validUploads.length === 0) return;

    // Check if all required fields are filled for each
    const incomplete = validUploads.some(u => !u.storeId || !u.vendor || !u.amount || !u.date);
    if (incomplete) {
      alert('Please fill all required fields (Store, Vendor, Date, Amount) for all invoices');
      return;
    }

    for (const upload of validUploads) {
      handleUpdatePendingUpload(upload.id, { status: 'uploading' });
      
      try {
        const store = STORES.find(s => s.id === upload.storeId)!;
        const amount = parseFloat(upload.amount);
        const chain = buildApprovalChain(store, amount);
        
        const newInvoice: Omit<Invoice, 'id'> = {
          vendor: upload.vendor,
          amount,
          date: upload.date,
          invoiceNumber: upload.invoiceNumber,
          poNumber: upload.poNumber,
          storeId: upload.storeId,
          storeName: store.name,
          division: store.division,
          region: store.region,
          acId: store.acId,
          directorId: store.directorId,
          status: 'PENDING',
          currentStage: chain[0].role,
          requiredApprovals: chain,
          approvalCycles: [{ cycle: 1, steps: [] }],
          createdAt: Date.now(),
          updatedAt: Date.now(),
          createdBy: currentUserId!,
          paidAt: null,
          archived: false,
          comments: []
        };

        if (isSupabaseConfigured) {
          const createdInvoice = await invoiceService.createInvoice(newInvoice as any);
          try {
            const fileUrl = await invoiceService.uploadInvoiceFile(upload.file, createdInvoice.id);
            await invoiceService.updateInvoice(createdInvoice.id, { fileUrl });
            handleUpdatePendingUpload(upload.id, { status: 'success' });
          } catch (err: any) {
            console.error('PDF Upload failed for bulk:', err);
            handleUpdatePendingUpload(upload.id, { status: 'error', error: `Upload failed: ${err.message || 'Unknown error'}` });
          }
        } else {
          // Local mode
          const id = `INV-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
          const invoiceWithId = { ...newInvoice, id } as Invoice;
          setInvoices(prev => [invoiceWithId, ...prev]);
          handleUpdatePendingUpload(upload.id, { status: 'success' });
        }
      } catch (err: any) {
        console.error('Bulk upload failed:', err);
        handleUpdatePendingUpload(upload.id, { status: 'error', error: err.message || 'Failed to save invoice' });
      }
    }
  };

  const handleSubmitInvoice = async () => {
    if (!uploadStoreId || !uploadVendor || !uploadAmount || !uploadDate || !selectedFile) {
      alert('Please fill all required fields and select a PDF file');
      return;
    }

    const store = STORES.find(s => s.id === uploadStoreId)!;
    const amount = parseFloat(uploadAmount);
    const chain = buildApprovalChain(store, amount);
    
    const newInvoice: Omit<Invoice, 'id'> = {
      vendor: uploadVendor,
      amount,
      date: uploadDate,
      invoiceNumber: uploadInvNum,
      poNumber: uploadPoNum,
      storeId: uploadStoreId,
      storeName: store.name,
      division: store.division,
      region: store.region,
      acId: store.acId,
      directorId: store.directorId,
      status: 'PENDING',
      currentStage: chain[0].role,
      requiredApprovals: chain,
      approvalCycles: [{ cycle: 1, steps: [] }],
      createdAt: Date.now(),
      updatedAt: Date.now(),
      createdBy: currentUserId,
      paidAt: null,
      archived: false,
      comments: []
    };

    if (isSupabaseConfigured) {
      try {
        const createdInvoice = await invoiceService.createInvoice(newInvoice as any);
        if (selectedFile) {
          try {
            const fileUrl = await invoiceService.uploadInvoiceFile(selectedFile, createdInvoice.id);
            await invoiceService.updateInvoice(createdInvoice.id, { fileUrl });
          } catch (uploadErr: any) {
            console.error('Failed to upload file to Supabase Storage:', uploadErr);
            alert(`Invoice data saved, but PDF upload failed: ${uploadErr.message || 'Unknown error'}. Please check if the "invoices" bucket exists and has correct RLS policies.`);
          }
        }
      } catch (err) {
        console.error('Failed to create invoice in Supabase:', err);
        alert('Failed to save invoice data.');
      }
    } else {
      const invWithId = { ...newInvoice, id: `INV-${Date.now()}` } as Invoice;
      setInvoices(prev => [invWithId, ...prev]);
    }

    setPage('dashboard');
    // Reset form
    setUploadStoreId('');
    setUploadVendor('');
    setUploadAmount('');
    setUploadInvNum('');
    setUploadPoNum('');
    setSelectedFile(null);
    setPdfPreviewUrl(null);
  };

  const handleLogin = (e: React.FormEvent) => {
    e.preventDefault();
    setLoginError('');
    
    const user = Object.values(USERS).find(
      u => u.firstName.toLowerCase() === loginFirstName.toLowerCase() && 
           u.lastName.toLowerCase() === loginLastName.toLowerCase()
    );
    
    if (user) {
      setCurrentUserId(user.id);
      localStorage.setItem('ap_tracker_user', user.id);
    } else {
      setLoginError('Invalid first or last name. Please try again.');
    }
  };

  const handleLogout = () => {
    setCurrentUserId(null);
    localStorage.removeItem('ap_tracker_user');
    setPage('dashboard');
  };

  if (!currentUser) {
    return (
      <div className="min-h-screen bg-[#f0ede8] flex items-center justify-center p-4 font-sans">
        <motion.div 
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="bg-white p-8 rounded-2xl shadow-xl w-full max-w-md border border-[#e0dbd3]"
        >
          <div className="flex flex-col items-center mb-8">
            <img src="https://raw.githubusercontent.com/DossaniParadise/invoice-tracker/main/logos/dpm-icon.png" className="w-16 h-16 rounded-xl mb-4 shadow-sm" alt="DPM" />
            <h1 className="text-2xl font-bold tracking-tight">Invoice Tracker</h1>
            <p className="text-sm text-[#8c909a] mt-1">Dossani Paradise Management</p>
          </div>

          <form onSubmit={handleLogin} className="space-y-5">
            <div className="space-y-1.5">
              <label className="text-xs font-bold text-[#8c909a] uppercase tracking-wider">First Name</label>
              <input 
                type="text" 
                required
                value={loginFirstName}
                onChange={(e) => setLoginFirstName(e.target.value)}
                placeholder="Enter your first name"
                className="w-full bg-[#faf9f7] border border-[#e0dbd3] rounded-xl px-4 py-3 text-sm outline-none focus:border-[#2a5f9e] transition-all"
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-bold text-[#8c909a] uppercase tracking-wider">Password</label>
              <input 
                type="password" 
                required
                value={loginLastName}
                onChange={(e) => setLoginLastName(e.target.value)}
                placeholder="Enter your password"
                className="w-full bg-[#faf9f7] border border-[#e0dbd3] rounded-xl px-4 py-3 text-sm outline-none focus:border-[#2a5f9e] transition-all"
              />
            </div>

            {loginError && (
              <motion.div 
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: 'auto' }}
                className="text-xs text-[#dc2626] bg-[#fef2f2] p-3 rounded-lg border border-[#dc2626]/20"
              >
                {loginError}
              </motion.div>
            )}

            <button 
              type="submit"
              className="w-full bg-[#2a5f9e] hover:bg-[#1d4a7d] text-white font-bold py-3 rounded-xl transition-all shadow-md active:scale-[0.98]"
            >
              Sign In
            </button>
          </form>
          
          <div className="mt-8 pt-6 border-t border-[#e0dbd3] text-center">
            <p className="text-[10px] text-[#8c909a] uppercase tracking-widest leading-relaxed">
              Authorized Personnel Only<br/>
              © 2025 Dossani Paradise Management
            </p>
          </div>
        </motion.div>
      </div>
    );
  }

  return (
    <div className="flex h-screen bg-[#f0ede8] text-[#1c1e22] font-sans overflow-hidden">
      {/* Sidebar */}
      <aside className="w-56 bg-[#1a1c20] flex flex-col h-full sticky top-0">
        <div className="p-4 border-b border-white/5 flex items-center gap-3">
          <img src="https://raw.githubusercontent.com/DossaniParadise/invoice-tracker/main/logos/dpm-icon.png" className="w-8 h-8 rounded-md" alt="DPM" />
          <div>
            <div className="text-sm font-semibold text-[#e8e5df] leading-tight">Invoice Tracker</div>
            <div className="text-[10px] text-[#6b6e76] uppercase tracking-wider">Dossani Paradise</div>
          </div>
        </div>
        
        <nav className="flex-1 py-4 overflow-y-auto">
          <div className="px-4 py-2 text-[10px] text-[#6b6e76] uppercase tracking-widest font-medium">Main</div>
          <NavItem active={page === 'dashboard'} onClick={() => setPage('dashboard')} icon={<LayoutDashboard size={16} />} label="Dashboard" />
          <NavItem active={page === 'upload'} onClick={() => setPage('upload')} icon={<Upload size={16} />} label="Upload Invoice" />
          <NavItem active={page === 'notifications'} onClick={() => setPage('notifications')} icon={<Bell size={16} />} label="Notifications" badge={notifications.filter(n => !n.read).length} />
          
          <div className="px-4 py-2 mt-4 text-[10px] text-[#6b6e76] uppercase tracking-widest font-medium">Analytics</div>
          <NavItem active={page === 'reports'} onClick={() => setPage('reports')} icon={<BarChart3 size={16} />} label="Reports" />
        </nav>

          <div className="p-4 border-t border-white/5 space-y-3">
            <button 
              onClick={handleLogout}
              className="w-full flex items-center gap-2 px-3 py-2 rounded-lg border border-white/10 text-[#6b6e76] hover:text-[#dc2626] hover:border-[#dc2626]/20 transition-all text-xs"
            >
              <RotateCcw size={14} />
              <span>Sign Out</span>
            </button>
            
            <button 
              onClick={() => setIsChangePasswordModalOpen(true)}
              className="w-full flex items-center gap-3 group text-left"
            >
              <div className="w-8 h-8 rounded-full bg-[#c9a84c] flex items-center justify-center text-[11px] font-bold text-[#1a1200] group-hover:ring-2 ring-[#c9a84c]/30 transition-all">
                {currentUser.initials}
              </div>
              <div className="min-w-0">
                <div className="text-xs font-medium text-[#e8e5df] truncate group-hover:text-[#c9a84c] transition-colors">{currentUser.name}</div>
                <div className="text-[10px] text-[#6b6e76] truncate">{currentUser.role.replace(/_/g, ' ')}</div>
              </div>
            </button>
          </div>
      </aside>

      {/* Main Content */}
      <main className="flex-1 flex flex-col min-w-0 overflow-auto">
        <header className="h-14 bg-white border-b border-[#e0dbd3] px-6 flex items-center gap-4 sticky top-0 z-10">
          <span className="text-sm font-semibold tracking-tight capitalize">{page}</span>
          {!isSupabaseConfigured && (
            <div className="bg-[#fdf6e3] text-[#92650a] text-[10px] px-2 py-1 rounded border border-[#c9a84c]/30 flex items-center gap-2">
              <Clock size={12} />
              <span>Temporary Mode: Connect Supabase in Settings to save data permanently.</span>
            </div>
          )}
          <div className="flex-1" />
          
          {currentUser && (currentUser.role === 'AP_SUPERVISOR' || currentUser.role === 'AP_COORDINATOR' || currentUser.id === 'it') && (
            <button 
              onClick={() => setIsReminderModalOpen(true)}
              className="bg-[#c9a84c] hover:bg-[#b09341] text-[#1a1200] text-[10px] font-bold px-3 py-1.5 rounded-md transition-colors flex items-center gap-1.5"
            >
              <Bell size={12} />
              <span>Send Reminders</span>
            </button>
          )}

          <button 
            onClick={() => setPage('upload')}
            className="bg-[#2a5f9e] hover:bg-[#1d4a7d] text-white text-xs font-medium px-3 py-1.5 rounded-md transition-colors"
          >
            + Upload Invoice
          </button>
        </header>

        <div className="p-6">
          <AnimatePresence mode="wait">
            {page === 'dashboard' && (
              <motion.div 
                key="dashboard"
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -10 }}
              >
                <div className="grid grid-cols-6 gap-3 mb-6">
                  <StatCard label="Total" value={stats.total} sub="All invoices" active={!statusFilter} onClick={() => setStatusFilter('')} />
                  <StatCard label="Pending" value={stats.counts.PENDING} sub="Awaiting action" color="#d97706" active={statusFilter === 'PENDING'} onClick={() => setStatusFilter('PENDING')} />
                  <StatCard label="Approved" value={stats.counts.APPROVED} sub="Ready to pay" color="#2563eb" active={statusFilter === 'APPROVED'} onClick={() => setStatusFilter('APPROVED')} />
                  <StatCard label="On Hold" value={stats.counts.HOLD} sub="Needs review" color="#7c3aed" active={statusFilter === 'HOLD'} onClick={() => setStatusFilter('HOLD')} />
                  <StatCard label="Denied" value={stats.counts.DENIED} sub="Rejected" color="#dc2626" active={statusFilter === 'DENIED'} onClick={() => setStatusFilter('DENIED')} />
                  <StatCard label="Paid" value={stats.counts.PAID} sub={`$${fmtAmt(stats.paidTotal)} total`} color="#059669" active={statusFilter === 'PAID'} onClick={() => setStatusFilter('PAID')} />
                </div>

                <div className="bg-white border border-[#e0dbd3] rounded-xl p-3 mb-5 flex flex-wrap items-center gap-3">
                  <FilterGroup label="Status">
                    <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className="bg-[#faf9f7] border border-[#e0dbd3] rounded-md px-2 py-1 text-xs outline-none">
                      <option value="">All</option>
                      <option value="PENDING">Pending</option>
                      <option value="APPROVED">Approved</option>
                      <option value="DENIED">Denied</option>
                      <option value="HOLD">Hold</option>
                      <option value="PAID">Paid</option>
                    </select>
                  </FilterGroup>
                  <div className="w-px h-4 bg-[#e0dbd3]" />
                  <FilterGroup label="Division">
                    <select value={divisionFilter} onChange={(e) => setDivisionFilter(e.target.value)} className="bg-[#faf9f7] border border-[#e0dbd3] rounded-md px-2 py-1 text-xs outline-none">
                      <option value="">All</option>
                      <option value="C-Store">C-Store</option>
                      <option value="Fast Food">Fast Food</option>
                      <option value="Car Wash">Car Wash</option>
                    </select>
                  </FilterGroup>
                  <div className="w-px h-4 bg-[#e0dbd3]" />
                  <FilterGroup label="Store">
                    <select value={storeFilter} onChange={(e) => setStoreFilter(e.target.value)} className="bg-[#faf9f7] border border-[#e0dbd3] rounded-md px-2 py-1 text-xs outline-none max-w-[120px]">
                      <option value="">All Stores</option>
                      {STORES.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                    </select>
                  </FilterGroup>
                  <div className="w-px h-4 bg-[#e0dbd3]" />
                  <FilterGroup label="Approver">
                    <select value={approverFilter} onChange={(e) => setApproverFilter(e.target.value)} className="bg-[#faf9f7] border border-[#e0dbd3] rounded-md px-2 py-1 text-xs outline-none max-w-[120px]">
                      <option value="">All</option>
                      {Object.values(USERS).filter(u => ['AREA_COACH', 'DIRECTOR', 'VP', 'COO', 'AP_SUPERVISOR', 'AP_COORDINATOR'].includes(u.role)).map(u => (
                        <option key={u.id} value={u.id}>{u.name}</option>
                      ))}
                    </select>
                  </FilterGroup>
                  <div className="flex-1" />
                  <div className="relative">
                    <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[#8c909a]" size={14} />
                    <input 
                      type="text" 
                      placeholder="Search vendor, invoice #..." 
                      value={searchFilter}
                      onChange={(e) => setSearchFilter(e.target.value)}
                      className="bg-[#faf9f7] border border-[#e0dbd3] rounded-md pl-8 pr-3 py-1 text-xs outline-none w-48 focus:border-[#2a5f9e]"
                    />
                  </div>
                </div>

                <div className="bg-white border border-[#e0dbd3] rounded-xl overflow-hidden shadow-sm">
                  <table className="w-full text-left border-collapse">
                    <thead>
                      <tr className="bg-[#faf9f7] text-[11px] text-[#8c909a] uppercase tracking-wider font-semibold">
                        <th className="px-4 py-3 border-b border-[#e0dbd3]">Vendor</th>
                        <th className="px-4 py-3 border-b border-[#e0dbd3]">Store</th>
                        <th className="px-4 py-3 border-b border-[#e0dbd3]">Amount</th>
                        <th className="px-4 py-3 border-b border-[#e0dbd3]">Date</th>
                        <th className="px-4 py-3 border-b border-[#e0dbd3]">Status</th>
                        <th className="px-4 py-3 border-b border-[#e0dbd3]">Stage</th>
                        <th className="px-4 py-3 border-b border-[#e0dbd3]"></th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[#ede9e3]">
                      {filteredInvoices.length === 0 ? (
                        <tr>
                          <td colSpan={7} className="py-20 text-center">
                            <div className="text-3xl opacity-20 mb-2">📋</div>
                            <div className="text-sm font-medium text-[#4a4e57]">No invoices found</div>
                            <div className="text-xs text-[#8c909a]">Try adjusting your filters</div>
                          </td>
                        </tr>
                      ) : (
                        filteredInvoices.map(inv => (
                          <tr key={inv.id} className="hover:bg-[#faf9f7] cursor-pointer transition-colors group" onClick={() => setActiveInvoice(inv)}>
                            <td className="px-4 py-3">
                              <div className="font-medium text-sm">{inv.vendor}</div>
                              <div className="font-mono text-[10px] text-[#8c909a] mt-0.5">{inv.id}</div>
                            </td>
                            <td className="px-4 py-3">
                              <div className="flex items-center gap-2">
                                <img 
                                  src={getStoreLogo(inv.storeName)} 
                                  className="w-7 h-7 rounded bg-[#faf9f7] p-0.5 object-contain" 
                                  alt="" 
                                  referrerPolicy="no-referrer"
                                  onError={(e) => {
                                    (e.target as HTMLImageElement).src = `https://api.dicebear.com/7.x/initials/svg?seed=${inv.storeName}&backgroundColor=2a5f9e&fontFamily=Inter&fontWeight=700`;
                                  }}
                                />
                                <div>
                                  <div className="text-[12.5px] leading-tight">{inv.storeName}</div>
                                  <div className="text-[10px] text-[#8c909a]">{inv.region}</div>
                                </div>
                              </div>
                            </td>
                            <td className="px-4 py-3 font-mono text-[12.5px] font-medium">${fmtAmt(inv.amount)}</td>
                            <td className="px-4 py-3 text-xs">{fmtDate(inv.date)}</td>
                            <td className="px-4 py-3">
                              <Badge status={inv.status} />
                            </td>
                            <td className="px-4 py-3">
                              <div className="flex items-center gap-2">
                                <span className="px-2 py-0.5 bg-[#faf9f7] border border-[#e0dbd3] rounded-full text-[10px] font-medium text-[#8c909a]">
                                  {inv.currentStage}
                                </span>
                                <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${
                                  inv.division === 'C-Store' ? 'bg-[#fdf6e3] text-[#92650a]' : 
                                  inv.division === 'Fast Food' ? 'bg-[#fef2f2] text-[#991b1b]' :
                                  'bg-[#ecfdf5] text-[#059669]'
                                }`}>
                                  {inv.division === 'C-Store' ? 'C' : inv.division === 'Fast Food' ? 'FF' : 'CW'}
                                </span>
                              </div>
                            </td>
                            <td className="px-4 py-3 text-right">
                              <div className="flex items-center justify-end gap-2">
                                {canUserMarkAsPaid(currentUser, inv) && (
                                  <button 
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      handleAction('PAID', 'Marked as paid from dashboard', inv);
                                    }}
                                    className="bg-[#059669] hover:bg-[#047857] text-white text-[10px] font-bold px-2 py-1 rounded transition-colors"
                                  >
                                    Mark Paid
                                  </button>
                                )}
                                <ChevronRight size={16} className="text-[#8c909a] group-hover:text-[#2a5f9e] transition-colors" />
                              </div>
                            </td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
              </motion.div>
            )}
            {page === 'upload' && (
              <motion.div 
                key="upload"
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -10 }}
                className="max-w-6xl mx-auto"
              >
                <div className="flex items-center justify-between mb-8">
                  <div className="flex items-center gap-4">
                    <button onClick={() => setPage('dashboard')} className="p-2 hover:bg-black/5 rounded-lg transition-colors">
                      <ArrowLeft size={18} />
                    </button>
                    <div>
                      <h2 className="text-2xl font-bold tracking-tight">Upload Invoices</h2>
                      <p className="text-sm text-[#8c909a] mt-1">Drag and drop multiple PDFs to upload in bulk.</p>
                    </div>
                  </div>
                  {isMultiUploadMode && (
                    <div className="flex items-center gap-3">
                      <button 
                        onClick={() => {
                          setPendingUploads([]);
                          setIsMultiUploadMode(false);
                          setSelectedFile(null);
                          setPdfPreviewUrl(null);
                        }}
                        className="px-4 py-2 text-xs font-bold text-[#dc2626] hover:bg-[#fef2f2] rounded-lg transition-colors"
                      >
                        Cancel All
                      </button>
                      <button 
                        onClick={handleBulkUpload}
                        className="bg-[#2a5f9e] hover:bg-[#1d4a7d] text-white px-6 py-2 rounded-lg text-sm font-bold shadow-lg shadow-[#2a5f9e]/20 transition-all flex items-center gap-2"
                      >
                        <Upload size={16} />
                        <span>Upload All Invoices</span>
                      </button>
                    </div>
                  )}
                </div>

                <div className={`grid gap-8 ${pdfPreviewUrl && !isMultiUploadMode ? 'grid-cols-1 lg:grid-cols-2' : 'grid-cols-1'}`}>
                  {/* Left Side: PDF Preview (if available and not in multi-mode) */}
                  {pdfPreviewUrl && !isMultiUploadMode && (
                    <div className="bg-white border border-[#e0dbd3] rounded-xl p-4 shadow-sm h-fit sticky top-6">
                      <div className="flex items-center justify-between mb-4">
                        <h2 className="text-xs font-medium text-[#4a4e57] uppercase tracking-wider">Invoice Preview</h2>
                        <button 
                          onClick={() => {
                            setSelectedFile(null);
                            setPdfPreviewUrl(null);
                          }}
                          className="text-[10px] text-[#dc2626] hover:underline"
                        >
                          Remove file
                        </button>
                      </div>
                      <div className="border border-[#e0dbd3] rounded-lg overflow-hidden bg-[#faf9f7] flex items-center justify-center min-h-[400px]">
                        <img src={pdfPreviewUrl} alt="PDF Preview" className="w-full h-auto shadow-lg" />
                      </div>
                    </div>
                  )}

                  {/* Form or List */}
                  {!isMultiUploadMode ? (
                    <div className="bg-white border border-[#e0dbd3] rounded-xl p-8 shadow-sm h-fit">
                      <div className="mb-8">
                        <label className="block text-xs font-medium text-[#4a4e57] mb-2 uppercase tracking-wider">PDF Document *</label>
                        <input 
                          type="file" 
                          ref={fileInputRef}
                          onChange={handleFileChange}
                          accept="application/pdf"
                          className="hidden"
                        />
                        {!pdfPreviewUrl ? (
                          <div 
                            onClick={() => fileInputRef.current?.click()}
                            onDragOver={(e) => e.preventDefault()}
                            onDrop={handleDrop}
                            className={`border-2 border-dashed rounded-xl p-10 text-center cursor-pointer transition-all group ${
                              selectedFile ? 'border-[#059669] bg-[#ecfdf5]' : 'border-[#e0dbd3] hover:border-[#2a5f9e] hover:bg-[#eaf1fb]'
                            }`}
                          >
                            <div className="text-4xl mb-3 group-hover:scale-110 transition-transform">
                              {selectedFile ? '✅' : '📄'}
                            </div>
                            <p className="text-sm font-medium">
                              {selectedFile ? selectedFile.name : 'Click to upload or drag & drop'}
                            </p>
                            <p className="text-[11px] text-[#8c909a] mt-1">
                              {selectedFile ? `${(selectedFile.size / 1024 / 1024).toFixed(2)} MB` : 'PDF only · max 25 MB'}
                            </p>
                          </div>
                        ) : (
                          <div className="flex items-center gap-3 p-3 bg-[#ecfdf5] border border-[#059669] rounded-lg">
                            <div className="text-xl">✅</div>
                            <div className="flex-1 min-w-0">
                              <p className="text-xs font-medium truncate">{selectedFile?.name}</p>
                              <p className="text-[10px] text-[#059669]">File ready for upload</p>
                            </div>
                            <button 
                              onClick={() => fileInputRef.current?.click()}
                              className="text-[10px] text-[#2a5f9e] hover:underline font-medium"
                            >
                              Change
                            </button>
                          </div>
                        )}
                      </div>

                      <div className="grid grid-cols-2 gap-5">
                        <div className="space-y-1.5">
                          <label className="text-xs font-medium text-[#4a4e57]">Store *</label>
                          <select 
                            value={uploadStoreId}
                            onChange={(e) => setUploadStoreId(e.target.value)}
                            className="w-full bg-[#faf9f7] border border-[#e0dbd3] rounded-lg px-3 py-2 text-sm outline-none focus:border-[#2a5f9e]"
                          >
                            <option value="">Select store...</option>
                            {visibleStores.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                          </select>
                        </div>
                        <div className="space-y-1.5">
                          <label className="text-xs font-medium text-[#4a4e57]">Vendor Name *</label>
                          <input 
                            type="text" 
                            list="vendor-list"
                            value={uploadVendor}
                            onChange={(e) => setUploadVendor(e.target.value)}
                            placeholder="e.g. Sysco Foods" 
                            className="w-full bg-[#faf9f7] border border-[#e0dbd3] rounded-lg px-3 py-2 text-sm outline-none focus:border-[#2a5f9e]" 
                          />
                        </div>
                        <div className="space-y-1.5">
                          <label className="text-xs font-medium text-[#4a4e57]">Invoice Date *</label>
                          <input 
                            type="date" 
                            value={uploadDate}
                            onChange={(e) => setUploadDate(e.target.value)}
                            className="w-full bg-[#faf9f7] border border-[#e0dbd3] rounded-lg px-3 py-2 text-sm outline-none focus:border-[#2a5f9e]" 
                          />
                        </div>
                        <div className="space-y-1.5">
                          <label className="text-xs font-medium text-[#4a4e57]">Amount ($) *</label>
                          <input 
                            type="number" 
                            value={uploadAmount}
                            onChange={(e) => setUploadAmount(e.target.value)}
                            placeholder="0.00" 
                            className="w-full bg-[#faf9f7] border border-[#e0dbd3] rounded-lg px-3 py-2 text-sm outline-none focus:border-[#2a5f9e]" 
                          />
                        </div>
                        <div className="space-y-1.5">
                          <label className="text-xs font-medium text-[#4a4e57]">Invoice #</label>
                          <input 
                            type="text" 
                            value={uploadInvNum}
                            onChange={(e) => setUploadInvNum(e.target.value)}
                            placeholder="INV-12345" 
                            className="w-full bg-[#faf9f7] border border-[#e0dbd3] rounded-lg px-3 py-2 text-sm outline-none focus:border-[#2a5f9e]" 
                          />
                        </div>
                        <div className="space-y-1.5">
                          <label className="text-xs font-medium text-[#4a4e57]">PO #</label>
                          <input 
                            type="text" 
                            value={uploadPoNum}
                            onChange={(e) => setUploadPoNum(e.target.value)}
                            placeholder="PO-67890" 
                            className="w-full bg-[#faf9f7] border border-[#e0dbd3] rounded-lg px-3 py-2 text-sm outline-none focus:border-[#2a5f9e]" 
                          />
                        </div>
                      </div>

                      <button 
                        onClick={handleSubmitInvoice}
                        disabled={!selectedFile || !uploadStoreId || !uploadVendor || !uploadAmount || !uploadDate}
                        className="w-full bg-[#2a5f9e] hover:bg-[#1d4a7d] disabled:opacity-50 disabled:cursor-not-allowed text-white py-4 rounded-xl mt-8 font-bold shadow-lg shadow-[#2a5f9e]/20 transition-all flex items-center justify-center gap-2"
                      >
                        <Upload size={18} />
                        <span>Submit Invoice for Approval</span>
                      </button>
                    </div>
                  ) : (
                    <div className="space-y-4">
                      {pendingUploads.map((upload) => (
                        <div key={upload.id} className={`bg-white border rounded-xl p-4 shadow-sm transition-all ${upload.status === 'error' ? 'border-[#dc2626]/30 bg-[#fef2f2]/30' : upload.status === 'success' ? 'border-[#059669]/30 bg-[#ecfdf5]/30' : 'border-[#e0dbd3]'}`}>
                          <div className="flex items-center gap-4 mb-4">
                            <div className="w-10 h-10 rounded-lg bg-[#faf9f7] flex items-center justify-center text-xl border border-[#e0dbd3]">
                              {upload.status === 'success' ? '✅' : upload.status === 'error' ? '❌' : '📄'}
                            </div>
                            <div className="flex-1 min-w-0">
                              <div className="text-sm font-bold truncate">{upload.file.name}</div>
                              <div className="text-[10px] text-[#8c909a]">{(upload.file.size / 1024 / 1024).toFixed(2)} MB</div>
                            </div>
                            {upload.status === 'error' && <div className="text-[10px] font-bold text-[#dc2626] uppercase">{upload.error}</div>}
                            {upload.status === 'idle' && (
                              <button 
                                onClick={() => handleRemovePendingUpload(upload.id)}
                                className="text-[#8c909a] hover:text-[#dc2626] transition-colors"
                              >
                                <XCircle size={18} />
                              </button>
                            )}
                          </div>

                          {upload.status !== 'success' && (
                            <div className="grid grid-cols-6 gap-3">
                              <div className="space-y-1">
                                <label className="text-[9px] font-bold text-[#8c909a] uppercase">Store *</label>
                                <select 
                                  value={upload.storeId}
                                  onChange={(e) => handleUpdatePendingUpload(upload.id, { storeId: e.target.value })}
                                  className="w-full bg-[#faf9f7] border border-[#e0dbd3] rounded-lg px-2 py-1.5 text-xs outline-none focus:border-[#2a5f9e]"
                                >
                                  <option value="">Select...</option>
                                  {visibleStores.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                                </select>
                              </div>
                              <div className="space-y-1">
                                <label className="text-[9px] font-bold text-[#8c909a] uppercase">Vendor *</label>
                                <input 
                                  type="text"
                                  list="vendor-list"
                                  value={upload.vendor}
                                  onChange={(e) => handleUpdatePendingUpload(upload.id, { vendor: e.target.value })}
                                  className="w-full bg-[#faf9f7] border border-[#e0dbd3] rounded-lg px-2 py-1.5 text-xs outline-none focus:border-[#2a5f9e]"
                                />
                              </div>
                              <div className="space-y-1">
                                <label className="text-[9px] font-bold text-[#8c909a] uppercase">Date *</label>
                                <input 
                                  type="date"
                                  value={upload.date}
                                  onChange={(e) => handleUpdatePendingUpload(upload.id, { date: e.target.value })}
                                  className="w-full bg-[#faf9f7] border border-[#e0dbd3] rounded-lg px-2 py-1.5 text-xs outline-none focus:border-[#2a5f9e]"
                                />
                              </div>
                              <div className="space-y-1">
                                <label className="text-[9px] font-bold text-[#8c909a] uppercase">Amount ($) *</label>
                                <input 
                                  type="number"
                                  value={upload.amount}
                                  onChange={(e) => handleUpdatePendingUpload(upload.id, { amount: e.target.value })}
                                  className="w-full bg-[#faf9f7] border border-[#e0dbd3] rounded-lg px-2 py-1.5 text-xs outline-none focus:border-[#2a5f9e]"
                                />
                              </div>
                              <div className="space-y-1">
                                <label className="text-[9px] font-bold text-[#8c909a] uppercase">Invoice #</label>
                                <input 
                                  type="text"
                                  value={upload.invoiceNumber}
                                  onChange={(e) => handleUpdatePendingUpload(upload.id, { invoiceNumber: e.target.value })}
                                  className="w-full bg-[#faf9f7] border border-[#e0dbd3] rounded-lg px-2 py-1.5 text-xs outline-none focus:border-[#2a5f9e]"
                                />
                              </div>
                              <div className="space-y-1">
                                <label className="text-[9px] font-bold text-[#8c909a] uppercase">PO #</label>
                                <input 
                                  type="text"
                                  value={upload.poNumber}
                                  onChange={(e) => handleUpdatePendingUpload(upload.id, { poNumber: e.target.value })}
                                  className="w-full bg-[#faf9f7] border border-[#e0dbd3] rounded-lg px-2 py-1.5 text-xs outline-none focus:border-[#2a5f9e]"
                                />
                              </div>
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </main>

      {/* Detail Overlay */}
      <AnimatePresence>
        {activeInvoice && (
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-8"
            onClick={() => setActiveInvoice(null)}
          >
            <motion.div 
              initial={{ scale: 0.95, opacity: 0, y: 20 }}
              animate={{ scale: 1, opacity: 1, y: 0 }}
              exit={{ scale: 0.95, opacity: 0, y: 20 }}
              className="bg-white rounded-2xl w-full max-w-5xl h-full max-h-[90vh] shadow-2xl overflow-hidden flex flex-col"
              onClick={e => e.stopPropagation()}
            >
              <header className="px-6 py-4 border-b border-[#e0dbd3] flex items-center gap-3">
                <h2 className="text-base font-semibold tracking-tight">{activeInvoice.id} — {activeInvoice.vendor}</h2>
                <Badge status={activeInvoice.status} />
                <div className="flex-1" />
                
                {currentUser && (currentUser.id === 'it' || currentUser.id === 'husain') && (
                  <div className="flex items-center gap-2">
                    {showDeleteConfirm ? (
                      <div className="flex items-center gap-2 bg-[#fef2f2] border border-[#dc2626]/20 rounded-lg px-2 py-1">
                        <span className="text-[10px] font-bold text-[#dc2626] uppercase">Confirm Delete?</span>
                        <button 
                          onClick={handleDeleteInvoice}
                          disabled={isDeleting}
                          className="bg-[#dc2626] hover:bg-[#b91c1c] text-white text-[10px] font-bold px-2 py-1 rounded transition-colors disabled:opacity-50"
                        >
                          {isDeleting ? 'Deleting...' : 'Yes, Delete'}
                        </button>
                        <button 
                          onClick={() => setShowDeleteConfirm(false)}
                          className="text-[#8c909a] hover:text-[#1a1c21] text-[10px] font-bold px-2 py-1 transition-colors"
                        >
                          Cancel
                        </button>
                      </div>
                    ) : (
                      <button 
                        onClick={() => setShowDeleteConfirm(true)}
                        className="flex items-center gap-1.5 text-[#dc2626] hover:bg-[#dc2626]/5 px-3 py-1.5 rounded-lg transition-colors text-xs font-medium"
                      >
                        <Trash2 size={14} />
                        <span>Delete</span>
                      </button>
                    )}
                    <div className="w-px h-4 bg-[#e0dbd3] mx-1" />
                  </div>
                )}

                <button onClick={() => setActiveInvoice(null)} className="p-2 hover:bg-black/5 rounded-lg transition-colors">
                  <XCircle size={20} className="text-[#8c909a]" />
                </button>
              </header>

              <div className="flex-1 flex overflow-hidden">
                {/* PDF Preview Area */}
                <div className="flex-1 bg-[#faf9f7] border-r border-[#e0dbd3] flex flex-col items-center justify-center p-10 gap-6 overflow-y-auto">
                  {pdfPreviewUrl || activeInvoice.fileUrl ? (
                    <div className="w-full max-w-3xl bg-white border border-[#e0dbd3] rounded-lg shadow-sm overflow-hidden h-full flex flex-col">
                      {pdfPreviewUrl && !activeInvoice.fileUrl ? (
                        <img src={pdfPreviewUrl} alt="Invoice Preview" className="w-full h-auto" />
                      ) : (
                        <iframe 
                          src={activeInvoice.fileUrl} 
                          className="w-full h-full min-h-[600px] border-none" 
                          title="Invoice PDF"
                        />
                      )}
                    </div>
                  ) : (
                    <div className="w-full max-w-md aspect-[8.5/11] bg-white border border-[#e0dbd3] rounded-lg shadow-sm flex flex-col items-center justify-center gap-3 text-[#8c909a]">
                      <FileText size={48} strokeWidth={1} />
                      <span className="text-xs font-medium">{activeInvoice.invoiceNumber || activeInvoice.id}.pdf</span>
                      <div className="text-center px-6">
                        <span className="text-[10px] opacity-60 block mb-1">Preview not available.</span>
                        <span className="text-[9px] opacity-40">Ensure Supabase Storage bucket "invoices" is public and file was uploaded successfully.</span>
                      </div>
                    </div>
                  )}
                  {activeInvoice.fileUrl && (
                    <a 
                      href={activeInvoice.fileUrl} 
                      target="_blank" 
                      rel="noopener noreferrer"
                      className="flex items-center gap-2 px-4 py-2 bg-white border border-[#e0dbd3] rounded-lg text-xs font-medium hover:bg-[#faf9f7] transition-colors"
                    >
                      <Download size={14} />
                      Download Full PDF
                    </a>
                  )}
                  {!activeInvoice.fileUrl && (
                    <button className="flex items-center gap-2 px-4 py-2 bg-white border border-[#e0dbd3] rounded-lg text-xs font-medium opacity-50 cursor-not-allowed">
                      <Download size={14} />
                      Download Not Available
                    </button>
                  )}
                  
                  <div className="w-full max-w-md mt-4 space-y-6">
                    {/* Action Area */}
                    {canUserAct(currentUser, activeInvoice) && (
                      <div className="bg-white border border-[#c9a84c]/30 rounded-xl p-4 shadow-sm">
                        <div className="text-[10px] uppercase tracking-widest font-bold text-[#c9a84c] mb-3">Take Action</div>
                        <div className="grid grid-cols-3 gap-2 mb-4">
                          <button 
                            onClick={() => setSelectedAction('APPROVED')}
                            className={`flex flex-col items-center gap-1 p-2 rounded-lg border transition-all ${selectedAction === 'APPROVED' ? 'bg-[#ecfdf5] border-[#059669] text-[#059669]' : 'border-[#e0dbd3] hover:bg-[#faf9f7]'}`}
                          >
                            <CheckCircle2 size={18} />
                            <span className="text-[10px] font-bold">Approve</span>
                          </button>
                          <button 
                            onClick={() => setSelectedAction('DENIED')}
                            className={`flex flex-col items-center gap-1 p-2 rounded-lg border transition-all ${selectedAction === 'DENIED' ? 'bg-[#fef2f2] border-[#dc2626] text-[#dc2626]' : 'border-[#e0dbd3] hover:bg-[#faf9f7]'}`}
                          >
                            <XCircle size={18} />
                            <span className="text-[10px] font-bold">Deny</span>
                          </button>
                          <button 
                            onClick={() => setSelectedAction('HOLD')}
                            className={`flex flex-col items-center gap-1 p-2 rounded-lg border transition-all ${selectedAction === 'HOLD' ? 'bg-[#f5f3ff] border-[#7c3aed] text-[#7c3aed]' : 'border-[#e0dbd3] hover:bg-[#faf9f7]'}`}
                          >
                            <PauseCircle size={18} />
                            <span className="text-[10px] font-bold">Hold</span>
                          </button>
                        </div>

                        {selectedAction && (
                          <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} className="space-y-3">
                            <textarea 
                              placeholder={`Add a note for ${selectedAction.toLowerCase()}...`}
                              className="w-full bg-[#faf9f7] border border-[#e0dbd3] rounded-lg p-2 text-xs outline-none focus:border-[#2a5f9e] min-h-[60px]"
                              value={newComment}
                              onChange={(e) => setNewComment(e.target.value)}
                            />
                            <button 
                              onClick={() => handleAction(selectedAction, newComment)}
                              className="w-full bg-[#2a5f9e] text-white py-2 rounded-lg text-xs font-bold hover:bg-[#1d4a7d] transition-all"
                            >
                              Save Action
                            </button>
                          </motion.div>
                        )}
                      </div>
                    )}

                    {/* Revoke Logic */}
                    {activeInvoice.approvalCycles[activeInvoice.approvalCycles.length - 1].steps.some(s => s.userId === currentUser.id && s.action === 'APPROVED') && (
                      <div className="bg-[#fef2f2] border border-[#dc2626]/20 rounded-xl p-4">
                        <div className="text-[10px] uppercase tracking-widest font-bold text-[#dc2626] mb-2">Revoke Approval</div>
                        <p className="text-[10px] text-[#6b6e76] mb-3">You have already approved this invoice. You can revoke your approval if it hasn't been paid yet.</p>
                        <button 
                          onClick={handleRevoke}
                          className="w-full bg-white border border-[#dc2626] text-[#dc2626] py-2 rounded-lg text-xs font-bold hover:bg-[#fef2f2] transition-all"
                        >
                          Revoke My Approval
                        </button>
                      </div>
                    )}

                    <div className="text-[10px] uppercase tracking-widest font-bold text-[#8c909a] mb-4">Approval Chain</div>
                    <div className="space-y-0 relative mb-8">
                      {activeInvoice.requiredApprovals.map((step, i) => {
                        const isApproved = activeInvoice.approvalCycles.some(c => c.steps.some(s => s.stage === step.role && s.action === 'APPROVED'));
                        const isCurrent = activeInvoice.currentStage === step.role;
                        
                        return (
                          <div key={step.role} className="relative">
                            {i < activeInvoice.requiredApprovals.length - 1 && (
                              <div className="absolute left-[11px] top-6 w-px h-8 bg-[#e0dbd3]" />
                            )}
                            <div className={`flex items-start gap-4 p-3 rounded-xl border transition-all ${isApproved ? 'bg-[#ecfdf5] border-[#059669]/30' : isCurrent ? 'bg-[#eaf1fb] border-[#2a5f9e]/30' : 'bg-transparent border-transparent opacity-50'}`}>
                              <div className={`w-6 h-6 rounded-full flex items-center justify-center text-[10px] border-2 ${isApproved ? 'bg-[#059669] border-[#059669] text-white' : isCurrent ? 'bg-white border-[#2a5f9e] text-[#2a5f9e]' : 'bg-transparent border-[#e0dbd3] text-[#8c909a]'}`}>
                                {isApproved ? '✓' : i + 1}
                              </div>
                              <div>
                                <div className="text-xs font-bold">{step.label} — <span className="font-normal opacity-70">{step.name}</span></div>
                                <div className="text-[10px] text-[#8c909a] mt-0.5">{isApproved ? 'Approved' : isCurrent ? 'Awaiting approval' : 'Pending'}</div>
                              </div>
                            </div>
                          </div>
                        );
                      }).reverse()}
                    </div>

                    <div className="text-[10px] uppercase tracking-widest font-bold text-[#8c909a] mb-4">Approval History</div>
                    <div className="space-y-3">
                      {activeInvoice.approvalCycles.flatMap(c => c.steps).length === 0 ? (
                        <div className="text-[10px] text-[#8c909a] italic">No actions taken yet.</div>
                      ) : (
                        activeInvoice.approvalCycles.flatMap(c => c.steps).sort((a, b) => b.ts - a.ts).map((step, i) => {
                          const user = USERS[step.userId];
                          const initials = user ? user.initials : '??';
                          const name = user ? user.name : 'Unknown User';
                          return (
                            <div key={i} className="flex gap-3 p-3 rounded-lg bg-[#faf9f7] border border-[#e0dbd3]">
                              <div className="w-8 h-8 rounded-full bg-[#2a5f9e]/10 flex items-center justify-center text-[10px] font-bold text-[#2a5f9e]">
                                {initials}
                              </div>
                              <div className="flex-1 min-w-0">
                                <div className="flex items-center justify-between gap-2">
                                  <div className="text-[11px] font-bold truncate">{name}</div>
                                  <div className="text-[9px] text-[#8c909a] whitespace-nowrap">{new Date(step.ts).toLocaleString()}</div>
                                </div>
                                <div className="flex items-center gap-2 mt-1">
                                  <span className={`text-[9px] px-1.5 py-0.5 rounded-full font-bold uppercase ${
                                    step.action === 'APPROVED' ? 'bg-[#ecfdf5] text-[#059669]' :
                                    step.action === 'DENIED' ? 'bg-[#fef2f2] text-[#dc2626]' :
                                    step.action === 'HOLD' ? 'bg-[#f5f3ff] text-[#7c3aed]' :
                                    'bg-[#fefce8] text-[#d97706]'
                                  }`}>
                                    {step.action}
                                  </span>
                                  <span className="text-[10px] text-[#6b6e76] italic">— {step.stage.replace(/_/g, ' ')}</span>
                                </div>
                                {step.comment && (
                                  <div className="mt-2 text-[11px] text-[#1c1e22] bg-white p-2 rounded border border-[#e0dbd3]">
                                    {step.comment}
                                  </div>
                                )}
                              </div>
                            </div>
                          );
                        })
                      )}
                    </div>
                  </div>
                </div>

                {/* Details Panel */}
                <div className="w-96 flex flex-col overflow-y-auto">
                  <div className="p-6 border-b border-[#e0dbd3] space-y-4">
                    <div className="text-[10px] uppercase tracking-widest font-bold text-[#8c909a]">Invoice Details</div>
                    <div className="space-y-2">
                      <DetailRow label="Vendor" value={activeInvoice.vendor} />
                      <DetailRow label="Amount" value={`$${fmtAmt(activeInvoice.amount)}`} mono />
                      <DetailRow label="Date" value={fmtDate(activeInvoice.date)} />
                      <DetailRow label="Store" value={activeInvoice.storeName} />
                      <DetailRow label="Division / Region" value={`${activeInvoice.division} · ${activeInvoice.region}`} />
                      <DetailRow label="Invoice #" value={activeInvoice.invoiceNumber || '—'} />
                      <DetailRow label="PO #" value={activeInvoice.poNumber || '—'} />
                      <DetailRow label="Submitted" value={fmtTs(activeInvoice.createdAt)} />
                      <DetailRow label="Paid" value={activeInvoice.paidAt ? fmtTs(activeInvoice.paidAt) : '—'} />
                    </div>
                  </div>

                  {/* Actions */}
                  <div className="p-6 bg-[#faf9f7] border-b border-[#e0dbd3]">
                    <div className="text-[10px] uppercase tracking-widest font-bold text-[#8c909a] mb-4">Actions</div>
                    <div className="space-y-2">
                      {canUserAct(currentUser, activeInvoice) ? (
                        <div className="grid grid-cols-2 gap-2">
                          <ActionButton icon={<CheckCircle2 size={14} />} label="Approve" color="#059669" onClick={() => handleAction('APPROVED', '')} />
                          <ActionButton icon={<PauseCircle size={14} />} label="Hold" color="#7c3aed" onClick={() => handleAction('HOLD', '')} />
                          <ActionButton icon={<XCircle size={14} />} label="Deny" color="#dc2626" onClick={() => handleAction('DENIED', '')} />
                          <ActionButton icon={<RotateCcw size={14} />} label="Push Back" color="#c9a84c" onClick={() => handleAction('PUSH_BACK', '')} />
                        </div>
                      ) : (
                        <div className="text-xs text-[#8c909a] italic">No actions available for your role at this stage.</div>
                      )}
                      {canUserMarkAsPaid(currentUser, activeInvoice) && (
                        <button 
                          onClick={() => handleAction('PAID', 'Marked as paid from details view')}
                          className="w-full bg-[#059669] hover:bg-[#047857] text-white py-2.5 rounded-lg text-xs font-bold shadow-lg shadow-[#059669]/20 transition-all flex items-center justify-center gap-2 mt-2"
                        >
                          <CheckCircle2 size={14} />
                          <span>Mark as Paid</span>
                        </button>
                      )}
                    </div>
                  </div>

                  {/* Comments */}
                  <div className="p-6 flex-1 flex flex-col">
                    <div className="text-[10px] uppercase tracking-widest font-bold text-[#8c909a] mb-4">Comments</div>
                    <div className="flex-1 space-y-4 mb-4">
                      {activeInvoice.comments.length === 0 ? (
                        <div className="text-xs text-[#8c909a] italic">No comments yet.</div>
                      ) : (
                        activeInvoice.comments.map(c => (
                          <div key={c.id} className="flex gap-3">
                            <div className="w-6 h-6 rounded-full bg-[#2a5f9e]/10 flex items-center justify-center text-[10px] font-bold text-[#2a5f9e] flex-shrink-0">
                              {USERS[c.userId]?.initials || '??'}
                            </div>
                            <div className="flex-1 bg-[#faf9f7] border border-[#e0dbd3] rounded-tr-xl rounded-br-xl rounded-bl-xl p-2.5">
                              <div className="flex justify-between items-baseline mb-1">
                                <span className="text-xs font-bold">{USERS[c.userId]?.name}</span>
                                <span className="text-[9px] text-[#8c909a]">{timeAgo(c.ts)}</span>
                              </div>
                              <p className="text-[12.5px] leading-relaxed">{c.text}</p>
                            </div>
                          </div>
                        ))
                      )}
                    </div>
                    <div className="flex gap-2">
                      <textarea 
                        className="flex-1 bg-[#faf9f7] border border-[#e0dbd3] rounded-xl p-2.5 text-xs outline-none focus:border-[#2a5f9e] resize-none"
                        placeholder="Add a comment..."
                        rows={2}
                        value={newComment}
                        onChange={(e) => setNewComment(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' && !e.shiftKey) {
                            e.preventDefault();
                            handleAddComment();
                          }
                        }}
                      />
                      <button 
                        onClick={handleAddComment}
                        disabled={isAddingComment || !newComment.trim()}
                        className="self-end p-2.5 bg-[#2a5f9e] text-white rounded-xl hover:bg-[#1d4a7d] transition-colors disabled:opacity-50"
                      >
                        <Send size={14} />
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Reminder Modal */}
      <AnimatePresence>
        {isReminderModalOpen && (
          <motion.div 
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/50 z-[60] flex items-center justify-center p-4"
            onClick={() => setIsReminderModalOpen(false)}
          >
            <motion.div 
              initial={{ scale: 0.95, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.95, opacity: 0 }}
              className="bg-white rounded-2xl w-full max-w-lg p-6 shadow-2xl"
              onClick={e => e.stopPropagation()}
            >
              <div className="flex items-center justify-between mb-6">
                <h3 className="text-lg font-bold">Send Reminder</h3>
                <button onClick={() => setIsReminderModalOpen(false)}><XCircle size={20} className="text-[#8c909a]" /></button>
              </div>

              <div className="space-y-4 mb-6">
                <div className="space-y-1.5">
                  <label className="text-[10px] font-bold text-[#8c909a] uppercase tracking-wider">Select Person</label>
                  <select 
                    value={reminderUserId}
                    onChange={(e) => setReminderUserId(e.target.value)}
                    className="w-full bg-[#faf9f7] border border-[#e0dbd3] rounded-xl px-4 py-3 text-sm outline-none focus:border-[#2a5f9e] transition-all"
                  >
                    <option value="">Choose a person...</option>
                    {Object.values(USERS).map(u => (
                      <option key={u.id} value={u.id}>{u.name} ({u.role.replace(/_/g, ' ')})</option>
                    ))}
                  </select>
                </div>

                {reminderUserId && (
                  <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="space-y-4">
                    {(() => {
                      const targetUser = USERS[reminderUserId];
                      const pendingCount = invoices.filter(inv => {
                        const currentStep = inv.requiredApprovals.find(s => s.role === inv.currentStage);
                        return currentStep?.userId === targetUser.id;
                      }).length;
                      const sendTo = `${targetUser.email || targetUser.id + '@dossaniparadise.com'}`;
                      const subject = `${pendingCount} Pending Invoice${pendingCount === 1 ? '' : 's'} to Approve`;
                      const body = `Hello ${targetUser.firstName || targetUser.name.split(' ')[0]},\n\nYou have ${pendingCount} pending invoice${pendingCount === 1 ? '' : 's'} awaiting your approval in the Invoice Tracker.\n\nLink: https://dossaniparadise.github.io/invoice-tracker/`;
                      
                      return (
                        <>
                          <div className="bg-[#faf9f7] border border-[#e0dbd3] rounded-xl p-4 font-mono text-[11px] whitespace-pre-wrap">
                            <div className="text-[#8c909a] mb-1 font-sans font-bold uppercase tracking-widest text-[9px]">Send to</div>
                            <div className="mb-3 text-[#1a1c21]">{sendTo}</div>
                            <div className="text-[#8c909a] mb-1 font-sans font-bold uppercase tracking-widest text-[9px]">Subject</div>
                            <div className="mb-3 text-[#1a1c21]">{subject}</div>
                            <div className="text-[#8c909a] mb-1 font-sans font-bold uppercase tracking-widest text-[9px]">Body</div>
                            <div className="text-[#1a1c21]">{body}</div>
                          </div>

                          <button 
                            onClick={() => {
                              navigator.clipboard.writeText(`Send to: ${sendTo}\nSubject: ${subject}\n\n${body}`);
                              alert('Reminder template copied to clipboard!');
                            }}
                            className="w-full bg-[#2a5f9e] text-white py-3 rounded-xl font-bold hover:bg-[#1d4a7d] transition-all flex items-center justify-center gap-2"
                          >
                            <Copy size={16} />
                            <span>Copy Template</span>
                          </button>
                        </>
                      );
                    })()}
                  </motion.div>
                )}
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Change Password Modal */}
      <AnimatePresence>
        {isChangePasswordModalOpen && (
          <motion.div 
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/50 z-[60] flex items-center justify-center p-4"
            onClick={() => setIsChangePasswordModalOpen(false)}
          >
            <motion.div 
              initial={{ scale: 0.95, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.95, opacity: 0 }}
              className="bg-white rounded-2xl w-full max-w-md p-6 shadow-2xl"
              onClick={e => e.stopPropagation()}
            >
              <div className="flex items-center justify-between mb-6">
                <h3 className="text-lg font-bold">Change Password</h3>
                <button onClick={() => setIsChangePasswordModalOpen(false)}><XCircle size={20} className="text-[#8c909a]" /></button>
              </div>
              
              <div className="space-y-4">
                <div className="space-y-1.5">
                  <label className="text-xs font-bold text-[#8c909a] uppercase tracking-wider">New Password</label>
                  <input 
                    type="password" 
                    className="w-full bg-[#faf9f7] border border-[#e0dbd3] rounded-xl px-4 py-3 text-sm outline-none focus:border-[#2a5f9e] transition-all"
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    placeholder="Enter new password"
                  />
                </div>
                <button 
                  onClick={() => {
                    alert('Password updated successfully! (Mock)');
                    setIsChangePasswordModalOpen(false);
                    setNewPassword('');
                  }}
                  className="w-full bg-[#2a5f9e] text-white py-3 rounded-xl font-bold hover:bg-[#1d4a7d] transition-all"
                >
                  Update Password
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function NavItem({ active, icon, label, onClick, badge }: { active: boolean, icon: React.ReactNode, label: string, onClick: () => void, badge?: number }) {
  return (
    <button 
      onClick={onClick}
      className={`w-full flex items-center gap-3 px-4 py-2.5 transition-all border-l-2 ${active ? 'bg-[#c9a84c]/10 text-[#c9a84c] border-[#c9a84c]' : 'text-[#6b6e76] hover:bg-white/5 hover:text-[#e8e5df] border-transparent'}`}
    >
      <span className="flex-shrink-0">{icon}</span>
      <span className="text-[13px] font-medium flex-1 text-left">{label}</span>
      {badge !== undefined && badge > 0 && (
        <span className="bg-[#dc2626] text-white text-[10px] font-bold px-1.5 py-0.5 rounded-full">{badge}</span>
      )}
    </button>
  );
}

function StatCard({ label, value, sub, color, active, onClick }: { label: string, value: number | string, sub: string, color?: string, active: boolean, onClick: () => void }) {
  return (
    <button 
      onClick={onClick}
      className={`bg-white border rounded-xl p-4 text-left transition-all ${active ? 'border-[#2a5f9e] shadow-sm bg-[#eaf1fb]' : 'border-[#e0dbd3] hover:border-[#8c909a]'}`}
    >
      <div className="text-[10px] text-[#8c909a] uppercase tracking-widest font-bold flex items-center gap-1.5 mb-2">
        {color && <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: color }} />}
        {label}
      </div>
      <div className="text-2xl font-bold tracking-tight" style={{ color: active ? '#2a5f9e' : color || 'inherit' }}>{value}</div>
      <div className="text-[11px] text-[#8c909a] mt-1">{sub}</div>
    </button>
  );
}

function FilterGroup({ label, children }: { label: string, children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-2">
      <span className="text-[11px] font-semibold text-[#8c909a] uppercase tracking-wider">{label}</span>
      {children}
    </div>
  );
}

function Badge({ status }: { status: Status }) {
  const styles: Record<Status, string> = {
    PENDING: 'bg-[#fef9ee] text-[#d97706]',
    APPROVED: 'bg-[#eff4ff] text-[#2563eb]',
    DENIED: 'bg-[#fef2f2] text-[#dc2626]',
    HOLD: 'bg-[#f3f0ff] text-[#7c3aed]',
    PAID: 'bg-[#ecfdf5] text-[#059669]'
  };
  
  return (
    <span className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[11px] font-bold tracking-wide ${styles[status]}`}>
      <span className="w-1 h-1 rounded-full bg-current" />
      {status}
    </span>
  );
}

function DetailRow({ label, value, mono }: { label: string, value: string, mono?: boolean }) {
  return (
    <div className="flex justify-between items-baseline py-1.5 border-b border-[#ede9e3] last:border-0">
      <span className="text-[11px] text-[#8c909a]">{label}</span>
      <span className={`text-xs font-medium text-right max-w-[60%] ${mono ? 'font-mono' : ''}`}>{value}</span>
    </div>
  );
}

function ActionButton({ icon, label, color, onClick }: { icon: React.ReactNode, label: string, color: string, onClick: () => void }) {
  return (
    <button 
      onClick={onClick}
      className="flex items-center justify-center gap-2 px-3 py-2 rounded-lg border border-[#e0dbd3] bg-white text-xs font-medium transition-all hover:shadow-sm"
      style={{ color }}
    >
      {icon}
      {label}
    </button>
  );
}
