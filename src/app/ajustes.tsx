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
import { SafeAreaView } from 'react-native-safe-area-context';
import { Picker } from '@react-native-picker/picker';
import * as SecureStore from 'expo-secure-store';

import { NoteSpacing } from '@/constants/theme';
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
      edges={['top']}
    >
      <ScrollView contentContainerStyle={styles.content}>
      <Text style={[styles.sectionTitle, { color: theme.notes.text.primary }]}>
        Proveedor de IA
      </Text>

      <View style={styles.field}>
        <Text style={[styles.label, { color: theme.notes.text.secondary }]}>Base URL</Text>
        <TextInput
          style={[
            styles.input,
            {
              backgroundColor: theme.notes.bg.elevated,
              borderColor: theme.notes.border.subtle,
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
        <Text style={[styles.label, { color: theme.notes.text.secondary }]}>API Key</Text>
        <TextInput
          style={[
            styles.input,
            {
              backgroundColor: theme.notes.bg.elevated,
              borderColor: theme.notes.border.subtle,
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
        <Text style={[styles.label, { color: theme.notes.text.secondary }]}>Modelo</Text>
        {modelos.length === 0 ? (
          <TouchableOpacity
            style={[
              styles.secondaryButton,
              {
                backgroundColor: theme.notes.bg.surface,
                borderColor: theme.notes.border.subtle,
              },
            ]}
            onPress={cargarModelos}
            disabled={cargandoModelos}
          >
            <Text style={[styles.secondaryButtonText, { color: theme.notes.text.secondary }]}>
              {cargandoModelos ? 'Cargando…' : 'Cargar modelos disponibles'}
              {cargandoModelos && (
                <ActivityIndicator
                  size="small"
                  color={theme.notes.text.secondary}
                  style={{ marginLeft: NoteSpacing.sm }}
                />
              )}
            </Text>
          </TouchableOpacity>
        ) : (
          <Picker
            selectedValue={model}
            onValueChange={setModel}
            style={[styles.picker, { backgroundColor: theme.notes.bg.elevated }]}
          >
            {modelos.map(m => (
              <Picker.Item key={m} label={m} value={m} />
            ))}
          </Picker>
        )}
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
  content: {
    padding: NoteSpacing.md,
    gap: NoteSpacing.md,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    marginBottom: 4,
  },
  field: {
    gap: 6,
  },
  label: {
    fontSize: 14,
    fontWeight: '600',
  },
  input: {
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 16,
  },
  picker: {
    borderRadius: 8,
  },
  secondaryButton: {
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  secondaryButtonText: {
    fontSize: 16,
    textAlign: 'center',
    flexDirection: 'row',
    alignItems: 'center',
  },
  hint: {
    fontSize: 12,
    marginTop: 2,
  },
  buttonContainer: {
    marginTop: NoteSpacing.sm,
  },
  button: {
    textAlign: 'center',
    paddingVertical: 14,
    borderRadius: 8,
    fontSize: 16,
    fontWeight: '600',
    overflow: 'hidden',
  },
});