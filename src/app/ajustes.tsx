import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { Stack } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Picker } from '@react-native-picker/picker';
import * as SecureStore from 'expo-secure-store';

import { BottomTabInset, NoteSpacing, Radii } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { ButtonBrand } from '@/components/ButtonBrand';

const KEY_BASE_URL = 'llm.baseUrl';
const KEY_API_KEY = 'llm.apiKey';
const KEY_MODEL = 'llm.model';

const DEFAULT_BASE_URL = 'https://api.minimax.io/v1';
const DEFAULT_MODEL = 'MiniMax-Text-01';

export default function AjustesScreen() {
  const theme = useTheme();
  const [baseUrl, setBaseUrl] = useState(DEFAULT_BASE_URL);
  const [apiKey, setApiKey] = useState('');
  const [model, setModel] = useState(DEFAULT_MODEL);
  const [saving, setSaving] = useState(false);
  const [modelos, setModelos] = useState<string[]>([]);
  const [cargandoModelos, setCargandoModelos] = useState(false);

  // Cargar valores almacenados al montar
  useEffect(() => {
    async function load() {
      try {
        const [storedBaseUrl, storedApiKey, storedModel] = await Promise.all([
          SecureStore.getItemAsync(KEY_BASE_URL),
          SecureStore.getItemAsync(KEY_API_KEY),
          SecureStore.getItemAsync(KEY_MODEL),
        ]);
        if (storedBaseUrl) setBaseUrl(storedBaseUrl);
        if (storedApiKey) setApiKey(storedApiKey);
        if (storedModel) setModel(storedModel);
      } catch {
        // Error al cargar: se mantienen los valores por defecto
      }
    }
    load();
  }, []);

  const guardar = async () => {
    if (!baseUrl.trim()) {
      Alert.alert('Error', 'La Base URL no puede estar vacía.');
      return;
    }
    if (!apiKey.trim()) {
      Alert.alert('Error', 'La API Key no puede estar vacía.');
      return;
    }
    if (!model.trim()) {
      Alert.alert('Error', 'El Modelo no puede estar vacío.');
      return;
    }

    setSaving(true);
    try {
      await Promise.all([
        SecureStore.setItemAsync(KEY_BASE_URL, baseUrl.trim()),
        SecureStore.setItemAsync(KEY_API_KEY, apiKey.trim()),
        SecureStore.setItemAsync(KEY_MODEL, model.trim()),
        SecureStore.setItemAsync('hasOnboarded', 'true'),
      ]);
      Alert.alert('Éxito', 'Configuración guardada correctamente.');
    } catch {
      Alert.alert('Error', 'No se pudo guardar la configuración.');
    } finally {
      setSaving(false);
    }
  };

  const cargarModelos = async () => {
    setCargandoModelos(true);
    if (!baseUrl.trim() || !apiKey.trim()) {
      Alert.alert('Error', 'Introduce URL base y API Key primero.');
      setCargandoModelos(false);
      return;
    }
    try {
      const response = await fetch(
        `${baseUrl.replace(/\/$/, '')}/models`,
        { headers: { Authorization: `Bearer ${apiKey}` } }
      );
      if (response.ok) {
        const json = await response.json();
        const ids: string[] = json.data.map((m: any) => m.id);
        setModelos(ids);
        if (ids.length > 0 && !ids.includes(model)) {
          setModel(ids[0]);
        }
      } else {
        Alert.alert('Error', 'No se pudieron obtener los modelos. Revisa tu URL y API Key.');
      }
    } catch {
      Alert.alert('Error', 'No se pudieron obtener los modelos. Revisa tu URL y API Key.');
    } finally {
      setCargandoModelos(false);
    }
  };

  return (
    <SafeAreaView
      style={[styles.container, { backgroundColor: theme.notes.bg.base }]}
      edges={[]}
    >
      <Stack.Screen options={{ title: 'Ajustes' }} />
      
      <ScrollView 
        contentContainerStyle={[styles.scrollContent, { paddingBottom: BottomTabInset + NoteSpacing['2xl'] }]}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.headerSection}>
          <Text style={[styles.title, { color: theme.notes.text.primary }]}>
            Ajustes
          </Text>
          <Text style={[styles.subtitle, { color: theme.notes.text.muted }]}>
            Configura tu entorno de trabajo
          </Text>
        </View>

        <View style={styles.section}>
          <Text style={[styles.sectionTitle, { color: theme.notes.text.secondary }]}>
            PROVEEDOR DE IA
          </Text>
          
          <View style={[styles.card, { backgroundColor: theme.notes.bg.surface, borderColor: theme.notes.border.subtle }]}>
            <View style={styles.field}>
              <Text style={[styles.label, { color: theme.notes.text.primary }]}>Base URL</Text>
              <TextInput
                style={[
                  styles.input,
                  {
                    backgroundColor: theme.notes.bg.elevated,
                    borderColor: theme.notes.border.strong,
                    color: theme.notes.text.primary,
                  },
                ]}
                value={baseUrl}
                onChangeText={setBaseUrl}
                placeholder="https://api.minimax.io/v1"
                placeholderTextColor={theme.notes.text.muted}
                autoCapitalize="none"
                autoCorrect={false}
                keyboardType="url"
              />
            </View>

            <View style={styles.field}>
              <Text style={[styles.label, { color: theme.notes.text.primary }]}>API Key</Text>
              <TextInput
                style={[
                  styles.input,
                  {
                    backgroundColor: theme.notes.bg.elevated,
                    borderColor: theme.notes.border.strong,
                    color: theme.notes.text.primary,
                  },
                ]}
                value={apiKey}
                onChangeText={setApiKey}
                placeholder="sk-..."
                placeholderTextColor={theme.notes.text.muted}
                autoCapitalize="none"
                autoCorrect={false}
                secureTextEntry
              />
              {Platform.OS !== 'web' && (
                <Text style={[styles.hint, { color: theme.notes.text.muted }]}>
                  Se almacena de forma segura en el dispositivo.
                </Text>
              )}
            </View>

            <View style={styles.field}>
              <Text style={[styles.label, { color: theme.notes.text.primary }]}>Modelo</Text>
              {modelos.length === 0 ? (
                <TouchableOpacity
                  style={[
                    styles.secondaryButton,
                    {
                      backgroundColor: theme.notes.bg.elevated,
                      borderColor: theme.notes.border.strong,
                    },
                  ]}
                  onPress={cargarModelos}
                  disabled={cargandoModelos}
                >
                  <View style={styles.secondaryButtonContent}>
                    <Text style={[styles.secondaryButtonText, { color: theme.notes.text.secondary }]}>
                      {cargandoModelos ? 'Cargando…' : 'Cargar modelos disponibles'}
                    </Text>
                    {cargandoModelos && (
                      <ActivityIndicator
                        size="small"
                        color={theme.notes.text.secondary}
                        style={{ marginLeft: NoteSpacing.sm }}
                      />
                    )}
                  </View>
                </TouchableOpacity>
              ) : (
                <View style={[styles.pickerContainer, { backgroundColor: theme.notes.bg.elevated, borderColor: theme.notes.border.strong }]}>
                  <Picker
                    selectedValue={model}
                    onValueChange={setModel}
                    style={{ color: theme.notes.text.primary }}
                    dropdownIconColor={theme.notes.text.secondary}
                  >
                    {modelos.map(m => (
                      <Picker.Item key={m} label={m} value={m} color={Platform.OS === 'ios' ? theme.notes.text.primary : undefined} />
                    ))}
                  </Picker>
                </View>
              )}
            </View>
          </View>
        </View>

        <View style={styles.buttonContainer}>
          <ButtonBrand
            title={saving ? 'Guardando…' : 'Guardar Configuración'}
            onPress={guardar}
            loading={saving}
            variant="primary"
            size="md"
          />
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  scrollContent: {
    paddingHorizontal: NoteSpacing.lg,
    paddingTop: NoteSpacing.lg,
  },
  headerSection: {
    marginBottom: NoteSpacing.xl,
  },
  title: {
    fontSize: 28,
    fontWeight: '700',
    letterSpacing: -0.5,
    marginBottom: 4,
  },
  subtitle: {
    fontSize: 15,
  },
  section: {
    marginBottom: NoteSpacing.xl,
  },
  sectionTitle: {
    fontFamily: 'ui-monospace',
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 1.2,
    marginBottom: NoteSpacing.md,
  },
  card: {
    borderWidth: 1,
    borderRadius: Radii.md,
    padding: NoteSpacing.lg,
    gap: NoteSpacing.lg,
  },
  field: {
    gap: 8,
  },
  label: {
    fontSize: 14,
    fontWeight: '600',
  },
  input: {
    borderWidth: 1,
    borderRadius: Radii.md,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 16,
  },
  pickerContainer: {
    borderWidth: 1,
    borderRadius: Radii.md,
    overflow: 'hidden',
  },
  secondaryButton: {
    borderWidth: 1,
    borderRadius: Radii.md,
    paddingHorizontal: 14,
    paddingVertical: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  secondaryButtonContent: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
  },
  secondaryButtonText: {
    fontSize: 15,
    fontWeight: '500',
  },
  hint: {
    fontSize: 13,
    marginTop: 2,
  },
  buttonContainer: {
    marginTop: NoteSpacing.sm,
  },
});