const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function checkErrors() {
  const { data, error } = await supabase
    .from('error_notifications')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(5);

  if (error) {
    console.log('Erro ao buscar:', error.message);
    return;
  }

  if (!data || data.length === 0) {
    console.log('Nenhum erro registrado');
    return;
  }

  for (const err of data) {
    console.log('---');
    console.log('Time:', err.created_at);
    console.log('Message:', err.message);
    if (err.details) {
      console.log('Path:', err.details.path);
      console.log('Stack:', err.details.stack?.substring(0, 300));
    }
  }
}

checkErrors();
