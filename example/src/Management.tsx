import { useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { useDeepgramManagement } from 'react-native-deepgram';
import Button from './components/Button';
import Card from './components/Card';
import Field from './components/Field';
import StatusBadge from './components/StatusBadge';
import { colors, radius, spacing, type } from './theme';

type Status = 'idle' | 'loading' | 'error';

export default function Management() {
  const { models, projects } = useDeepgramManagement();

  const [modelsList, setModelsList] = useState<string[]>([]);
  const [modelsStatus, setModelsStatus] = useState<Status>('idle');
  const [modelsError, setModelsError] = useState<string | null>(null);

  const [modelId, setModelId] = useState('');
  const [modelJson, setModelJson] = useState('');
  const [modelStatus, setModelStatus] = useState<Status>('idle');
  const [modelError, setModelError] = useState<string | null>(null);

  const [projectsJson, setProjectsJson] = useState('');
  const [projectsStatus, setProjectsStatus] = useState<Status>('idle');
  const [projectsError, setProjectsError] = useState<string | null>(null);

  const listAllModels = async () => {
    setModelsStatus('loading');
    setModelsError(null);
    try {
      const res = await models.list(false);
      setModelsList(res.stt ? res.stt.map((m) => m.name) : []);
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

  return (
    <View style={styles.container}>
      <ScrollView contentContainerStyle={styles.scrollContent}>
        <View style={styles.hero}>
          <Text style={styles.heroIcon}>⚙️</Text>
          <Text style={styles.heroTitle}>Management API</Text>
          <Text style={styles.heroSubtitle}>
            Inspect projects, keys, models, and usage. Requires a Deepgram key
            with management scopes.
          </Text>
        </View>

        {/* Models */}
        <Card
          title="Models"
          subtitle="List available STT models"
          right={
            <StatusBadge
              tone={
                modelsStatus === 'error'
                  ? 'error'
                  : modelsStatus === 'loading'
                    ? 'connecting'
                    : 'idle'
              }
              label={modelsStatus.toUpperCase()}
            />
          }
        >
          <Button
            title="List STT models"
            variant="primary"
            onPress={listAllModels}
            loading={modelsStatus === 'loading'}
            disabled={modelsStatus === 'loading'}
            iconLeft="📋"
          />
          {modelsError ? (
            <View style={styles.errorBanner}>
              <Text style={styles.errorText}>⚠ {modelsError}</Text>
            </View>
          ) : null}
          {modelsList.length > 0 ? (
            <View style={styles.list}>
              {modelsList.map((name) => (
                <View key={name} style={styles.listRow}>
                  <View style={styles.bullet} />
                  <Text style={styles.listText}>{name}</Text>
                </View>
              ))}
            </View>
          ) : (
            <Text style={styles.placeholder}>
              {modelsStatus === 'loading'
                ? 'Loading…'
                : 'No models loaded yet.'}
            </Text>
          )}
        </Card>

        <Card title="Get a model" subtitle="Look up a model by UUID">
          <Field
            value={modelId}
            onChangeText={setModelId}
            placeholder="Enter model UUID"
            autoCapitalize="none"
            autoCorrect={false}
          />
          <Button
            title="Get model"
            variant="primary"
            onPress={getSingleModel}
            loading={modelStatus === 'loading'}
            disabled={modelStatus === 'loading' || !modelId.trim()}
            iconLeft="🔍"
          />
          {modelError ? (
            <View style={styles.errorBanner}>
              <Text style={styles.errorText}>⚠ {modelError}</Text>
            </View>
          ) : null}
          {modelJson ? (
            <ScrollView horizontal style={styles.jsonWrap}>
              <Text style={styles.json}>{modelJson}</Text>
            </ScrollView>
          ) : null}
        </Card>

        {/* Projects */}
        <Card
          title="Projects"
          subtitle="List your Deepgram projects"
          right={
            <StatusBadge
              tone={
                projectsStatus === 'error'
                  ? 'error'
                  : projectsStatus === 'loading'
                    ? 'connecting'
                    : 'idle'
              }
              label={projectsStatus.toUpperCase()}
            />
          }
        >
          <Button
            title="List projects"
            variant="primary"
            onPress={listAllProjects}
            loading={projectsStatus === 'loading'}
            disabled={projectsStatus === 'loading'}
            iconLeft="📁"
          />
          {projectsError ? (
            <View style={styles.errorBanner}>
              <Text style={styles.errorText}>⚠ {projectsError}</Text>
            </View>
          ) : null}
          {projectsJson ? (
            <ScrollView horizontal style={styles.jsonWrap}>
              <Text style={styles.json}>{projectsJson}</Text>
            </ScrollView>
          ) : (
            <Text style={styles.placeholder}>No projects loaded yet.</Text>
          )}
        </Card>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  scrollContent: { padding: spacing.lg, paddingBottom: spacing.xxl },
  hero: {
    backgroundColor: colors.surface,
    borderRadius: radius.xl,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.xl,
    alignItems: 'center',
    marginBottom: spacing.lg,
  },
  heroIcon: { fontSize: 40, marginBottom: spacing.sm },
  heroTitle: { ...type.h2, color: colors.text },
  heroSubtitle: {
    ...type.small,
    color: colors.textMuted,
    marginTop: 4,
    textAlign: 'center',
    paddingHorizontal: spacing.md,
  },
  errorBanner: {
    backgroundColor: '#3a1418',
    borderColor: colors.danger,
    borderWidth: 1,
    borderRadius: radius.md,
    padding: spacing.md,
    marginTop: spacing.md,
  },
  errorText: { color: colors.danger, ...type.smallMedium },
  list: { marginTop: spacing.md },
  listRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 6,
  },
  bullet: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: colors.primary,
    marginRight: spacing.sm,
  },
  listText: { ...type.body, color: colors.text },
  placeholder: {
    ...type.small,
    color: colors.textDim,
    fontStyle: 'italic',
    marginTop: spacing.md,
  },
  jsonWrap: {
    marginTop: spacing.md,
    maxHeight: 220,
    backgroundColor: colors.surfaceMuted,
    borderRadius: radius.md,
    padding: spacing.md,
  },
  json: {
    fontFamily: 'Menlo',
    color: colors.textMuted,
    fontSize: 12,
  },
});
