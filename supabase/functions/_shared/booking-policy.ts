type SupabaseAdmin = {
  from: (table: string) => any;
};

export async function hasCompletedService(admin: SupabaseAdmin, userId: string): Promise<boolean> {
  const { data, error } = await admin
    .from('appointments')
    .select('id')
    .eq('user_id', userId)
    .ilike('status', 'Conclu%')
    .limit(1);

  if (error) throw error;
  return Array.isArray(data) && data.length > 0;
}