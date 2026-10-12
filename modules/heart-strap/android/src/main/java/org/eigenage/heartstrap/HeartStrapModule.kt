package org.eigenage.heartstrap

import android.annotation.SuppressLint
import android.bluetooth.BluetoothAdapter
import android.bluetooth.BluetoothDevice
import android.bluetooth.BluetoothGatt
import android.bluetooth.BluetoothGattCallback
import android.bluetooth.BluetoothGattCharacteristic
import android.bluetooth.BluetoothGattDescriptor
import android.bluetooth.BluetoothManager
import android.bluetooth.BluetoothProfile
import android.bluetooth.le.ScanCallback
import android.bluetooth.le.ScanResult
import android.bluetooth.le.ScanSettings
import android.content.Context
import android.os.Build
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.util.UUID

private val HEART_RATE = UUID.fromString("0000180d-0000-1000-8000-00805f9b34fb")
private val MEASUREMENT = UUID.fromString("00002a37-0000-1000-8000-00805f9b34fb")
private val CONFIG = UUID.fromString("00002902-0000-1000-8000-00805f9b34fb")
private val STRAP_NAME = Regex("polar|hrm|tickr|heart", RegexOption.IGNORE_CASE)

/**
 * A Bluetooth heart-rate strap, read through the standard Heart Rate service
 * (0x180D): a Polar H10, or any strap that sends beat-to-beat intervals in its
 * Heart Rate Measurement (0x2A37). The bytes go to JavaScript as they arrive;
 * they are parsed and read there (`src/rr.ts`), where they are tested.
 *
 * Events:
 *   onDevice       a heart-rate device seen while scanning: id, name, rssi
 *   onState        connecting, connected or disconnected, with an error when
 *                  the connection failed or dropped
 *   onMeasurement  one Heart Rate Measurement: its bytes, and when it arrived
 *
 * The permissions it needs (BLUETOOTH_SCAN and BLUETOOTH_CONNECT) are asked
 * for in JavaScript before any of these are called.
 */
@SuppressLint("MissingPermission")
class HeartStrapModule : Module() {
  private val context: Context?
    get() = appContext.reactContext

  private val adapter: BluetoothAdapter?
    get() = (context?.getSystemService(Context.BLUETOOTH_SERVICE) as? BluetoothManager)?.adapter

  private var scanning = false
  private var gatt: BluetoothGatt? = null
  private val seen = mutableMapOf<String, String>()

  private val scanCallback = object : ScanCallback() {
    override fun onScanResult(callbackType: Int, result: ScanResult) = report(result)

    override fun onBatchScanResults(results: MutableList<ScanResult>) = results.forEach { report(it) }

    override fun onScanFailed(errorCode: Int) {
      scanning = false
      sendEvent("onState", mapOf("state" to "disconnected", "id" to null, "error" to "Bluetooth scan failed ($errorCode)."))
    }
  }

  private fun report(r: ScanResult) {
    val record = r.scanRecord
    val name = record?.deviceName ?: ""
    // Straps advertise the Heart Rate service; a few put it only in the scan response, so a strap's name also counts.
    val heart = record?.serviceUuids?.any { it.uuid == HEART_RATE } == true || STRAP_NAME.containsMatchIn(name)
    if (!heart) return
    val id = r.device.address
    synchronized(seen) {
      if (seen[id] == name) return
      seen[id] = name
    }
    sendEvent("onDevice", mapOf("id" to id, "name" to name, "rssi" to r.rssi))
  }

  private val gattCallback = object : BluetoothGattCallback() {
    override fun onConnectionStateChange(g: BluetoothGatt, status: Int, newState: Int) {
      if (newState == BluetoothProfile.STATE_CONNECTED && status == BluetoothGatt.GATT_SUCCESS) {
        g.discoverServices()
      } else if (newState == BluetoothProfile.STATE_DISCONNECTED || status != BluetoothGatt.GATT_SUCCESS) {
        val error = if (status == BluetoothGatt.GATT_SUCCESS) null else "The strap disconnected (status $status)."
        g.close()
        if (gatt == g) gatt = null
        sendEvent("onState", mapOf("state" to "disconnected", "id" to g.device.address, "error" to error))
      }
    }

    override fun onServicesDiscovered(g: BluetoothGatt, status: Int) {
      val ch = g.getService(HEART_RATE)?.getCharacteristic(MEASUREMENT)
      if (status != BluetoothGatt.GATT_SUCCESS || ch == null) {
        sendEvent("onState", mapOf("state" to "disconnected", "id" to g.device.address, "error" to "This device sends no heart rate."))
        g.disconnect()
        return
      }
      g.setCharacteristicNotification(ch, true)
      val d = ch.getDescriptor(CONFIG)
      if (d != null) {
        if (Build.VERSION.SDK_INT >= 33) {
          g.writeDescriptor(d, BluetoothGattDescriptor.ENABLE_NOTIFICATION_VALUE)
        } else {
          @Suppress("DEPRECATION")
          d.value = BluetoothGattDescriptor.ENABLE_NOTIFICATION_VALUE
          @Suppress("DEPRECATION")
          g.writeDescriptor(d)
        }
      }
      sendEvent("onState", mapOf("state" to "connected", "id" to g.device.address, "name" to (g.device.name ?: "")))
    }

    // Android 13 and later.
    override fun onCharacteristicChanged(g: BluetoothGatt, c: BluetoothGattCharacteristic, value: ByteArray) = emit(g, c, value)

    // Android 12 and earlier.
    @Deprecated("Replaced by the overload with the value from Android 13")
    override fun onCharacteristicChanged(g: BluetoothGatt, c: BluetoothGattCharacteristic) {
      @Suppress("DEPRECATION")
      emit(g, c, c.value ?: return)
    }
  }

  private fun emit(g: BluetoothGatt, c: BluetoothGattCharacteristic, value: ByteArray) {
    if (c.uuid != MEASUREMENT) return
    sendEvent(
      "onMeasurement",
      mapOf("id" to g.device.address, "bytes" to value.map { it.toInt() and 0xFF }, "at" to System.currentTimeMillis().toDouble()),
    )
  }

  private fun stopScanning() {
    if (!scanning) return
    scanning = false
    try {
      adapter?.bluetoothLeScanner?.stopScan(scanCallback)
    } catch (_: Exception) {}
  }

  private fun closeGatt() {
    gatt?.let {
      try {
        it.disconnect()
        it.close()
      } catch (_: Exception) {}
    }
    gatt = null
  }

  override fun definition() = ModuleDefinition {
    Name("HeartStrap")

    Events("onDevice", "onState", "onMeasurement")

    /** "on", "off", or "none" when the phone has no Bluetooth. */
    Function("bluetooth") {
      val a = adapter ?: return@Function "none"
      if (a.isEnabled) "on" else "off"
    }

    Function("startScan") {
      val scanner = adapter?.bluetoothLeScanner ?: throw IllegalStateException("Bluetooth is off.")
      stopScanning()
      synchronized(seen) { seen.clear() }
      val settings = ScanSettings.Builder().setScanMode(ScanSettings.SCAN_MODE_LOW_LATENCY).build()
      scanner.startScan(null, settings, scanCallback)
      scanning = true
    }

    Function("stopScan") { stopScanning() }

    Function("connect") { id: String ->
      val a = adapter ?: throw IllegalStateException("Bluetooth is off.")
      val ctx = context ?: throw IllegalStateException("No Android context.")
      stopScanning()
      closeGatt()
      val device = a.getRemoteDevice(id)
      sendEvent("onState", mapOf("state" to "connecting", "id" to id))
      gatt = device.connectGatt(ctx, false, gattCallback, BluetoothDevice.TRANSPORT_LE)
    }

    Function("disconnect") {
      stopScanning()
      closeGatt()
    }

    OnDestroy {
      stopScanning()
      closeGatt()
    }
  }
}
