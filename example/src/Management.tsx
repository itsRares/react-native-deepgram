import { useState } from 'react';
import {
  View,
  Button,
  Text,
  TextInput,
  ScrollView,
  StyleSheet,
} from 'react-native';
import { useDeepgramManagement } from 'react-native-deepgram';

export default function Management() {
  /* ---------- hook ---------- */
  const { models, projects } = useDeepgramManagement();

  /* ---------- state ---------- */
  const [modelsJson, setModelsJson] = useState('');
  const [modelsStatus, setModelsStatus] = useState<
    'idle' | 'loading' | 'error'
  >('idle');
  const [modelsError, setModelsError] = useState<string | null>(null);

  const [modelId, setModelId] = useState('');
  const [modelJson, setModelJson] = useState('');
  const [modelStatus, setModelStatus] = useState<'idle' | 'loading' | 'error'>(
    'idle'
  );
  const [modelError, setModelError] = useState<string | null>(null);

  const [projectsJson, setProjectsJson] = useState('');
  const [projectsStatus, setProjectsStatus] = useState<
    'idle' | 'loading' | 'error'
  >('idle');
  const [projectsError, setProjectsError] = useState<string | null>(null);

  /* ---------- handlers ---------- */
  const listAllModels = async () => {
    setModelsStatus('loading');
    setModelsError(null);
    try {
      const res = await models.list(false);
      setModelsJson(
        res.stt ? res.stt.map((m) => m.name).join('\n') : 'No models found.'
      );
      setModelsStatus('idle');
    } catch (err) {
      setModelsStatus('error');
      setModelsError(err instanceof Error ? err.message : String(err));
    }
  };

  const getSingleModel = async () => {
    if (!modelId.trim()) return;
    setModelStatus('loading');
    setModelError(null);
    try {
      const res = await models.get(modelId.trim());
      setModelJson(JSON.stringify(res, null, 2));
      setModelStatus('idle');
    } catch (err) {
      setModelStatus('error');
      setModelError(err instanceof Error ? err.message : String(err));
    }
  };

  const listAllProjects = async () => {
    setProjectsStatus('loading');
    setProjectsError(null);
    try {
      const res = await projects.list();
      setProjectsJson(JSON.stringify(res, null, 2));
      setProjectsStatus('idle');
    } catch (err) {
      setProjectsStatus('error');
      setProjectsError(err instanceof Error ? err.message : String(err));
    }
  };

  /* ---------- UI ---------- */
  return (
    <View style={styles.container}>
      {/* MODELS --------------------------------------------------- */}
      <Text style={styles.sectionTitle}>Models</Text>
      <View style={styles.buttonRow}>
        <Button
          title="List STT Models"
          onPress={listAllModels}
          disabled={modelsStatus === 'loading'}
        />
      </View>
      {modelsStatus === 'loading' && (
        <Text style={styles.status}>Loading…</Text>
      )}
      {modelsError && <Text style={styles.error}>Error: {modelsError}</Text>}
      <ScrollView style={styles.output}>
        <Text>{modelsJson || 'No model list yet.'}</Text>
      </ScrollView>

      {/* Single model by UUID */}
      <View style={[styles.buttonRow, styles.modelSection]}>
        <TextInput
          style={styles.input}
          placeholder="Enter model UUID"
          value={modelId}
          onChangeText={setModelId}
        />
        <Button
          title="Get Model"
          onPress={getSingleModel}
          disabled={modelStatus === 'loading' || !modelId.trim()}
        />
      </View>
      {modelStatus === 'loading' && (
        <Text style={styles.status}>Fetching…</Text>
      )}
      {modelError && <Text style={styles.error}>Error: {modelError}</Text>}
      <ScrollView style={styles.output}>
        <Text>{modelJson || 'No single-model data yet.'}</Text>
      </ScrollView>

      {/* PROJECTS ------------------------------------------------ */}
      <Text style={styles.sectionTitle}>Projects</Text>
      <View style={styles.buttonRow}>
        <Button
          title="List Projects"
          onPress={listAllProjects}
          disabled={projectsStatus === 'loading'}
        />
      </View>
      {projectsStatus === 'loading' && (
        <Text style={styles.status}>Loading…</Text>
      )}
      {projectsError && (
        <Text style={styles.error}>Error: {projectsError}</Text>
      )}
      <ScrollView style={styles.output}>
        <Text>{projectsJson || 'No project list yet.'}</Text>
      </ScrollView>
    </View>
  );
}

/* ---------- styles ---------- */
const styles = StyleSheet.create({
  container: {
    flex: 1,
    padding: 16,
    backgroundColor: '#fff',
  },
  sectionTitle: {
    marginTop: 24,
    marginBottom: 8,
    fontWeight: '600',
    fontSize: 16,
  },
  buttonRow: {
    flexDirection: 'row',
    justifyContent: 'flex-start',
    alignItems: 'center',
    gap: 8,
  },
  input: {
    flex: 1,
    borderWidth: 1,
    borderColor: '#ccc',
    borderRadius: 4,
    paddingHorizontal: 8,
    height: 40,
  },
  status: {
    marginVertical: 4,
    fontStyle: 'italic',
  },
  error: {
    marginVertical: 4,
    color: 'red',
  },
  modelSection: {
    marginTop: 16,
  },
  output: {
    maxHeight: 160,
    marginTop: 4,
    marginBottom: 12,
    padding: 8,
    borderWidth: 1,
    borderColor: '#eee',
    borderRadius: 4,
  },
});
