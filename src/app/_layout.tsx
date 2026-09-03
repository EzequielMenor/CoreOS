import { DarkTheme, DefaultTheme, ThemeProvider, Stack } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { useEffect, useMemo, useState } from 'react';
import { AppState, StyleSheet, Text, View, useColorScheme, type AppStateStatus } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import Toast from 'react-native-toast-message';
import * as Linking from 'expo-linking';

import { AnimatedSplashOverlay } from '@/components/animated-icon';
import { initDb, resetDatabase, insertInbox } from '@/db';
import { processPendingInbox } from '@/services/inbox';
import { useNotesStore } from '@/stores/notes';
import { useTagsStore } from '@/stores/tags';

import { Colors } from '@/constants/theme';

SplashScreen.preventAutoHideAsync();

// ponytail: estados de error internos (campo `error` en cada store) cubren
// el flujo normal; este catch solo dispara en rechazos no capturados.
function notifyError(label: string): (e: unknown) => void {
  return (e: unknown) => {
    const message = e instanceof Error ? e.message : String(e);
    console.error(`[layout] ${label}:`, message);
    Toast.show({ type: 'error', text1: label, text2: message });
  };
}

export default function TabLayout() {
  const [dbReady, setDbReady] = useState(false);

  useEffect(() => {
    initDb()
      .then(() => {
        SplashScreen.hideAsync();
        setDbReady(true);
        useNotesStore.getState().fetchSections().catch(notifyError('Notes'));
        useTagsStore.getState().fetchTags().catch(notifyError('Tags'));
        // Disparo fire-and-forget: drena capturas pendientes del run anterior.
        // I4: processPendingInbox nunca lanza.
        void processPendingInbox();
      })
      .catch(async (e) => {
        console.warn('[layout] initDb failed, attempting nuclear reset of corrupted database');
        try {
          await resetDatabase();
          await initDb();
          SplashScreen.hideAsync();
          setDbReady(true);
          useNotesStore.getState().fetchSections().catch(notifyError('Notes'));
          useTagsStore.getState().fetchTags().catch(notifyError('Tags'));
          void processPendingInbox();
        } catch {
          SplashScreen.hideAsync();
          setDbReady(true);
          notifyError('initDb')(e);
        }
      });
  }, []);

  const scheme = useColorScheme();
  const themeColors = Colors[scheme === 'dark' ? 'dark' : 'light'];

  const url = Linking.useURL();

  useEffect(() => {
    if (!url || !dbReady) return;
    const parsed = Linking.parse(url);
    if (parsed.path === 'capture' || parsed.hostname === 'capture') {
      const text = parsed.queryParams?.text;
      if (typeof text === 'string' && text.trim().length > 0) {
        insertInbox(text.trim())
          .then(() => {
            Toast.show({ type: 'success', text1: 'Captura recibida' });
            void processPendingInbox();
          })
          .catch(notifyError('Inbox DeepLink'));
      }
    }
  }, [url, dbReady]);

  // AppState 'active': drena el inbox cuando el usuario vuelve a foreground.
  // El mutex _batchInFlight cubre concurrencia con el resto de triggers.
  useEffect(() => {
    const handler = (status: AppStateStatus) => {
      if (status === 'active') {
        void processPendingInbox();
      }
    };
    const sub = AppState.addEventListener('change', handler);
    return () => {
      sub.remove();
    };
  }, []);

  // ponytail: useMemo debe estar ANTES del early return (Rules of Hooks).
  const toastConfig = useMemo(() => ({
    success: (props: { text1?: string; text2?: string }) => (
      <View style={[styles.customToast, { backgroundColor: themeColors.notes.bg.elevated, borderColor: themeColors.notes.border.subtle }]}>
        <View style={[styles.iconWrap, { backgroundColor: themeColors.notes.semantic.success + '20' }]}>
          <Text style={{ fontSize: 16 }}>✨</Text>
        </View>
        <View style={styles.textWrap}>
          <Text style={[styles.customToastTitle, { color: themeColors.notes.text.primary }]}>{props.text1}</Text>
          {props.text2 ? <Text style={[styles.customToastSubtitle, { color: themeColors.notes.text.secondary }]}>{props.text2}</Text> : null}
        </View>
      </View>
    ),
    error: (props: { text1?: string; text2?: string }) => (
      <View style={[styles.customToast, { backgroundColor: themeColors.notes.bg.elevated, borderColor: themeColors.notes.semantic.danger + '40' }]}>
        <View style={[styles.iconWrap, { backgroundColor: themeColors.notes.semantic.danger + '20' }]}>
          <Text style={{ fontSize: 16 }}>⚠️</Text>
        </View>
        <View style={styles.textWrap}>
          <Text style={[styles.customToastTitle, { color: themeColors.notes.text.primary }]}>{props.text1}</Text>
          {props.text2 ? <Text style={[styles.customToastSubtitle, { color: themeColors.notes.text.secondary }]}>{props.text2}</Text> : null}
        </View>
      </View>
    ),
    info: (props: { text1?: string; text2?: string }) => (
      <View style={[styles.customToast, { backgroundColor: themeColors.notes.bg.elevated, borderColor: themeColors.notes.border.subtle }]}>
        <View style={[styles.iconWrap, { backgroundColor: themeColors.notes.accent.primary + '20' }]}>
          <Text style={{ fontSize: 16 }}>💡</Text>
        </View>
        <View style={styles.textWrap}>
          <Text style={[styles.customToastTitle, { color: themeColors.notes.text.primary }]}>{props.text1}</Text>
          {props.text2 ? <Text style={[styles.customToastSubtitle, { color: themeColors.notes.text.secondary }]}>{props.text2}</Text> : null}
        </View>
      </View>
    ),
  }), [themeColors]);

  if (!dbReady) return null;

  const secondaryHeaderOptions = {
    headerShown: true,
    headerStyle: { backgroundColor: themeColors.notes.bg.base },
    headerTintColor: themeColors.notes.accent.primary,
    headerTitleStyle: { color: themeColors.notes.text.primary, fontWeight: '600' as const },
    headerShadowVisible: false,
    headerBackTitle: 'Inicio',
  };

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <ThemeProvider value={scheme === 'dark' ? DarkTheme : DefaultTheme}>
          <AnimatedSplashOverlay />
          <Stack screenOptions={{ headerShown: false }}>
            <Stack.Screen name="(tabs)" />
            <Stack.Screen name="tareas" options={{ ...secondaryHeaderOptions, title: 'Tareas' }} />
            <Stack.Screen name="ajustes" options={{ ...secondaryHeaderOptions, title: 'Ajustes' }} />
          </Stack>
          {/* ponytail: topOffset hardcoded (notch iPhone 14-16 ≈ 47pt + 8pt padding). Las screens que necesiten más espacio usan useSafeAreaInsets(). */}
          <Toast config={toastConfig} topOffset={55} />
        </ThemeProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}

const styles = StyleSheet.create({
  customToast: {
    width: '90%',
    maxWidth: 400,
    borderRadius: 16,
    borderWidth: 1,
    paddingHorizontal: 16,
    paddingVertical: 12,
    flexDirection: 'row',
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.15,
    shadowRadius: 12,
    elevation: 8,
    alignSelf: 'center',
  },
  iconWrap: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  textWrap: {
    flex: 1,
    justifyContent: 'center',
  },
  customToastTitle: {
    fontSize: 15,
    fontWeight: '600',
  },
  customToastSubtitle: {
    fontSize: 13,
    marginTop: 2,
  },
});
