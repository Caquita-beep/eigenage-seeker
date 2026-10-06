import { NativeTabs } from "expo-router/unstable-native-tabs";
import { color } from "../../theme";

export default function TabsLayout() {
  return (
    <NativeTabs
      backgroundColor={color.surface}
      indicatorColor={color.raised}
      iconColor={{ default: color.faint, selected: color.text }}
      labelStyle={{ default: { color: color.faint }, selected: { color: color.text } }}
      rippleColor={color.raised}
    >
      <NativeTabs.Trigger name="index">
        <NativeTabs.Trigger.Label>Today</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon md="dashboard" />
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="insights">
        <NativeTabs.Trigger.Label>Insights</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon md="insights" />
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="body">
        <NativeTabs.Trigger.Label>Body</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon md="favorite" />
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="market">
        <NativeTabs.Trigger.Label>Market</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon md="show_chart" />
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="wallet">
        <NativeTabs.Trigger.Label>Wallet</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon md="account_balance_wallet" />
      </NativeTabs.Trigger>
    </NativeTabs>
  );
}
