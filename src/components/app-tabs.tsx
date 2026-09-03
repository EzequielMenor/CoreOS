import { NativeTabs } from 'expo-router/unstable-native-tabs';
import { useColorScheme } from 'react-native';

import { Colors } from '@/constants/theme';

export default function AppTabs() {
  const scheme = useColorScheme();
  const colors = Colors[scheme === 'unspecified' ? 'light' : scheme];

  return (
    <NativeTabs
      backgroundColor={colors.background}
      indicatorColor={colors.backgroundElement}
      labelStyle={{ selected: { color: colors.text } }}>
      <NativeTabs.Trigger name="index">
        <NativeTabs.Trigger.Label>Hoy</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon sf="house.fill" />
      </NativeTabs.Trigger>

      <NativeTabs.Trigger name="capturar">
        <NativeTabs.Trigger.Label>Capturar</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon sf="square.and.pencil" />
      </NativeTabs.Trigger>

      <NativeTabs.Trigger name="notas">
        <NativeTabs.Trigger.Label>Biblioteca</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon sf="doc.text.fill" />
      </NativeTabs.Trigger>
    </NativeTabs>
  );
}
