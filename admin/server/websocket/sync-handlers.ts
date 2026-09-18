import { WebSocket } from 'ws';
import {
  createTimeEntry,
  updateTimeEntry,
  createActivity,
  getActivityById,
  updateActivity,
} from '../database.js';
import { clients, broadcastToAdmins } from './clients.js';
import { wsLog } from './log.js';

/** Handle `time-entry:started` — persist and broadcast to admins. */
export async function handleTimeEntryStarted(ws: WebSocket, message: any): Promise<void> {
  const client = clients.get(ws);
  if (!client) return;

  wsLog(`⏱️ ${client.employeeName} started tracking`);
  try {
    await createTimeEntry(client.orgId!, message.entry);
  } catch (err) {
    console.error('Error saving time entry:', err);
  }
  broadcastToAdmins(client.orgId!, {
    type: 'time-entry:started',
    data: {
      employeeId: client.employeeId,
      employeeName: client.employeeName,
      entry: message.entry,
      timestamp: new Date().toISOString(),
    },
  });
}

/** Handle `time-entry:stopped` — persist and broadcast to admins. */
export async function handleTimeEntryStopped(ws: WebSocket, message: any): Promise<void> {
  const client = clients.get(ws);
  if (!client) return;

  wsLog(`⏹️ ${client.employeeName} stopped tracking`);
  try {
    await updateTimeEntry(client.orgId!, message.entry.id, {
      endTime: message.entry.endTime,
      duration: message.entry.duration,
      idleTime: message.entry.idleTime,
    });
  } catch (err) {
    console.error('Error updating time entry:', err);
  }
  broadcastToAdmins(client.orgId!, {
    type: 'time-entry:stopped',
    data: {
      employeeId: client.employeeId,
      employeeName: client.employeeName,
      entry: message.entry,
      timestamp: new Date().toISOString(),
    },
  });
}

/** Handle `time-entries` — batch activity sync from device. */
export async function handleTimeEntriesSync(ws: WebSocket, message: any): Promise<void> {
  const client = clients.get(ws);
  if (!client) return;

  wsLog(`📤 ${client.employeeName} synced ${message.entries?.length || 0} activities`);

  if (!message.entries || !Array.isArray(message.entries)) return;

  let successCount = 0;
  let errorCount = 0;
  let lastError: string | null = null;

  for (const entry of message.entries) {
    try {
      // Device tokens may only write their own employee activities
      const entryEmployeeId =
        client.tokenType === 'device' ? client.employeeId : entry.employeeId;
      if (!entryEmployeeId) {
        errorCount++;
        lastError = 'Missing employeeId';
        continue;
      }
      const safeEntry = { ...entry, employeeId: entryEmployeeId };
      const existing = await getActivityById(client.orgId!, safeEntry.id);
      if (existing) {
        await updateActivity(client.orgId!, safeEntry.id, safeEntry);
      } else {
        await createActivity(client.orgId!, safeEntry);
      }
      successCount++;
    } catch (err: any) {
      console.error('Error syncing activity:', err);
      errorCount++;
      lastError = err.message || 'Unknown error';
    }
  }

  ws.send(JSON.stringify({
    type: 'sync:response',
    data: {
      success: errorCount === 0,
      successCount,
      errorCount,
      message: errorCount > 0
        ? `Synced ${successCount} activities, ${errorCount} failed. Last error: ${lastError}`
        : `Successfully synced ${successCount} activities`,
    },
  }));

  if (successCount > 0) {
    broadcastToAdmins(client.orgId!, {
      type: 'sync:completed',
      data: {
        employeeId: client.employeeId,
        employeeName: client.employeeName,
        count: successCount,
        timestamp: new Date().toISOString(),
      },
    });
  }
}
