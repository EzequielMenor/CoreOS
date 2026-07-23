import { DarkTheme, DefaultTheme, ThemeProvider } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { useEffect, useState } from 'react';
import { useColorScheme } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import Toast from 'react-native-toast-message';

import { AnimatedSplashOverlay } from '@/components/animated-icon';
import { initDb, resetDatabase } from '@/db';
import { useIdeasStore } from '@/stores/ideas';
import { useNotesStore } from '@/stores/notes';
import { useTagsStore } from '@/stores/tags';
import AppTabs from '@/components/app-tabs';

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
        useIdeasStore.getState().fetchIdeas().catch(notifyError('Ideas'));
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
          useIdeasStore.getState().fetchIdeas().catch(notifyError('Ideas'));
        } catch {
          SplashScreen.hideAsync();
          setDbReady(true);
          notifyError('initDb')(e);
        }
      });
  }, []);

  const scheme = useColorScheme();

  if (!dbReady) return null;

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <ThemeProvider value={scheme === 'dark' ? DarkTheme : DefaultTheme}>
          <AnimatedSplashOverlay />
          <AppTabs />
          {/* ponytail: topOffset hardcoded (notch iPhone 14-16 ≈ 47pt + 8pt padding). Las screens que necesiten más espacio usan useSafeAreaInsets(). */}
          <Toast topOffset={55} />
        </ThemeProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
