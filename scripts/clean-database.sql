-- =====================================================
-- SCRIPT DE LIMPEZA DO BANCO DE DADOS
-- Execute no Supabase SQL Editor
-- =====================================================

-- Desabilitar triggers temporariamente para evitar erros de FK
SET session_replication_role = 'replica';

-- Limpar tabelas na ordem correta (dependências primeiro)
TRUNCATE TABLE document_embeddings CASCADE;
TRUNCATE TABLE processing_logs CASCADE;
TRUNCATE TABLE dead_letter_queue CASCADE;
TRUNCATE TABLE batch_items CASCADE;
TRUNCATE TABLE batch_jobs CASCADE;
TRUNCATE TABLE task_queue CASCADE;
TRUNCATE TABLE rate_limits CASCADE;
TRUNCATE TABLE text_extractions CASCADE;
TRUNCATE TABLE audio_transcriptions CASCADE;
TRUNCATE TABLE documents CASCADE;

-- Reabilitar triggers
SET session_replication_role = 'origin';

-- Verificar contagem (deve ser 0 em todas)
SELECT 'documents' as tabela, COUNT(*) as registros FROM documents
UNION ALL
SELECT 'audio_transcriptions', COUNT(*) FROM audio_transcriptions
UNION ALL
SELECT 'text_extractions', COUNT(*) FROM text_extractions
UNION ALL
SELECT 'document_embeddings', COUNT(*) FROM document_embeddings
UNION ALL
SELECT 'batch_jobs', COUNT(*) FROM batch_jobs
UNION ALL
SELECT 'task_queue', COUNT(*) FROM task_queue
UNION ALL
SELECT 'dead_letter_queue', COUNT(*) FROM dead_letter_queue;

-- =====================================================
-- OPCIONAL: Limpar Storage também
-- Execute separadamente se quiser limpar arquivos
-- =====================================================
-- DELETE FROM storage.objects WHERE bucket_id = 'documents';
