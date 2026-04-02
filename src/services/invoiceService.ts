import { supabase } from '../lib/supabase';
import { Invoice, Status } from '../types';

export const invoiceService = {
  async getInvoices() {
    if (!supabase) return [];
    const { data, error } = await supabase
      .from('invoices')
      .select('*')
      .order('createdAt', { ascending: false });
    
    if (error) throw error;
    return data as Invoice[];
  },

  async createInvoice(invoice: Omit<Invoice, 'id'>) {
    if (!supabase) throw new Error('Supabase not configured');
    const { data, error } = await supabase
      .from('invoices')
      .insert([invoice])
      .select()
      .single();
    
    if (error) throw error;
    return data as Invoice;
  },

  async updateInvoice(id: string, updates: Partial<Invoice>) {
    if (!supabase) throw new Error('Supabase not configured');
    const { data, error } = await supabase
      .from('invoices')
      .update(updates)
      .eq('id', id)
      .select()
      .single();
    
    if (error) throw error;
    return data as Invoice;
  },

  subscribeToInvoices(callback: (payload: any) => void) {
    if (!supabase) return { unsubscribe: () => {} };
    return supabase
      .channel('invoices-changes')
      .on('postgres_changes' as any, { event: '*', table: 'invoices' }, callback)
      .subscribe();
  }
};
