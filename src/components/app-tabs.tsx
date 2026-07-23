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
        <NativeTabs.Trigger.Label>Home</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon sf="house.fill" />
      </NativeTabs.Trigger>

      <NativeTabs.Trigger name="notas">
        <NativeTabs.Trigger.Label>Notas</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon sf="doc.text.fill" />
      </NativeTabs.Trigger>

      <NativeTabs.Trigger name="tareas">
        <NativeTabs.Trigger.Label>Tareas</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon sf="checkmark.circle.fill" />
      </NativeTabs.Trigger>

      <NativeTabs.Trigger name="gastos">
        <NativeTabs.Trigger.Label>Gastos</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon sf="eurosign.circle.fill" />
      </NativeTabs.Trigger>

      <NativeTabs.Trigger name="habitos">
        <NativeTabs.Trigger.Label>Hábitos</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon sf="flame.fill" />
      </NativeTabs.Trigger>

      <NativeTabs.Trigger name="sueno">
        <NativeTabs.Trigger.Label>Sueño</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon sf="moon.zzz.fill" />
      </NativeTabs.Trigger>

      <NativeTabs.Trigger name="ajustes">
        <NativeTabs.Trigger.Label>Ajustes</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon sf="gearshape.fill" />
      </NativeTabs.Trigger>
    </NativeTabs>
  );
}
