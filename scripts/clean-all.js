const { createClient } = require('@supabase/supabase-js');
const Redis = require('ioredis');
require('dotenv').config();

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function cleanStorage() {
  console.log('🗂️  Limpando Storage...\n');

  const { data: files, error } = await supabase.storage
    .from('documents')
    .list('uploads', { limit: 1000 });

  if (error) {
    console.log('❌ Erro ao listar:', error.message);
    return;
  }

  if (!files || files.length === 0) {
    console.log('📁 Storage já está vazio');
    return;
  }

  for (const folder of files) {
    if (folder.id === null) {
      const { data: subFiles } = await supabase.storage
        .from('documents')
        .list('uploads/' + folder.name, { limit: 1000 });

      if (subFiles && subFiles.length > 0) {
        const paths = subFiles.map(f => 'uploads/' + folder.name + '/' + f.name);
        const { error: delError } = await supabase.storage
          .from('documents')
          .remove(paths);

        if (delError) {
          console.log('❌ Erro deletando ' + folder.name + ': ' + delError.message);
        } else {
          console.log('✅ Pasta uploads/' + folder.name + ': ' + paths.length + ' arquivos removidos');
        }
      }
    }
  }

  console.log('✅ Storage limpo!');
}

async function cleanRedis() {
  console.log('\n🔴 Limpando Redis...\n');

  const redis = new Redis(process.env.REDIS_URL);

  const keys = await redis.keys('taxdoc:*');
  console.log('   Chaves encontradas: ' + keys.length);

  await redis.flushdb();
  console.log('✅ Redis limpo!');

  await redis.quit();
}

async function main() {
  await cleanStorage();
  await cleanRedis();
  console.log('\n🎉 Limpeza completa!');
}

main().catch(console.error);
