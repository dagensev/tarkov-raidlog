/**
 * Fixtures modelled on real Escape from Tarkov logs.
 *
 * The line and payload *shapes* are copied from real logs under
 * `C:\Battlestate Games\Escape from Tarkov\Logs`, but every identifier is synthetic:
 * the real notifications log carries a live websocket session token, account ids, and
 * friends' nicknames, none of which belong in a repository.
 *
 * Profile ids keep their real 8-hex timestamp prefix, because that prefix is exactly
 * what wipe detection reads. It encodes a date and nothing else.
 */

/** 1.1.x header: no timezone offset. */
export const APP_LINES_V11 = [
  "2026-09-01 19:27:08.691|1.1.0.1.46911|Info|application|Application awaken, updateQueue:'Update'",
  "2026-09-01 19:45:01.100|1.1.0.1.46911|Info|application|Session mode: PvpSeason",
  "2026-09-01 19:50:12.000|1.1.0.1.46911|Info|application|scene preset path:maps/shoreline_preset.bundle rcid:shoreline.scenespreset.asset",
  "2026-09-01 19:51:00.000|1.1.0.1.46911|Info|application|MatchingCompleted:2.81 real:10.18 diff:7.37",
  "2026-09-01 19:51:30.000|1.1.0.1.46911|Info|application|LocationLoaded:25.95 real:40.08 diff:14.13",
  "2026-09-01 19:52:00.000|1.1.0.1.46911|Info|application|GameStarted:62.91(62.91) real:86.45(86.45) diff:23.53",
].join("\n");

/** 1.0.x header: carries an explicit timezone offset. */
export const APP_LINES_V10 = [
  "2025-11-15 14:28:22.869 -07:00|1.0.0.0.41760|Info|application|SelectProfile ProfileId:5e5c26bf000000000000000d AccountId:1234567",
  "2025-11-15 14:28:22.869 -07:00|1.0.0.0.41760|Debug|application|TRACE-NetworkGameCreate profileStatus: 'Profileid: 5e5c26bf000000000000000d, Status: Busy, RaidMode: Online, Ip: 10.0.0.1, Port: 17000, Location: Interchange, Sid: XX-XXX00X000_0000_00.00.00_00-00-00, GameMode: deathmatch, shortId: AAAAAA'",
].join("\n");

/** Quest completed: `<taskId> successMessageText` with `message.type` 12. */
export const TASK_FINISHED = `2025-11-15 18:31:04.414 -07:00|1.0.0.0.41760|Info|push-notifications|Got notification | ChatMessageReceived
{
  "type": "new_message",
  "eventId": "000000000000000000000001",
  "dialogId": "54cb57776803fa99248b456e",
  "message": {
    "_id": "000000000000000000000002",
    "uid": "54cb57776803fa99248b456e",
    "type": 12,
    "dt": 1763256663,
    "text": "",
    "templateId": "657315ddab5a49b71f098853 successMessageText",
    "items": {
      "stash": "000000000000000000000003",
      "data": []
    }
  }
}`;

/** Quest accepted: `<taskId> description` with `message.type` 10. */
export const TASK_STARTED = `2026-08-25 19:55:00.000|1.1.0.1.46911|Info|push-notifications|Got notification | ChatMessageReceived
{
  "type": "new_message",
  "eventId": "000000000000000000000004",
  "dialogId": "5a7c2eca46aef81a7ca2145d",
  "message": {
    "uid": "5a7c2eca46aef81a7ca2145d",
    "type": 10,
    "dt": 1787000000,
    "templateId": "657315e270bb0b8dba00cc48 description"
  }
}`;

/** A trader message that is not a quest state change; must produce no event. */
export const TRADER_CHATTER = `2026-08-25 19:56:00.000|1.1.0.1.46911|Info|push-notifications|Got notification | ChatMessageReceived
{
  "type": "new_message",
  "eventId": "000000000000000000000005",
  "dialogId": "5bdabfb886f7743e152e867e",
  "message": {
    "uid": "5bdabfb886f7743e152e867e",
    "type": 2,
    "dt": 1787000100,
    "templateId": "5bdabfb886f7743e152e867e 0"
  }
}`;

/** Match confirmed: carries the map, raid mode and short id. */
export const USER_CONFIRMED = `2026-09-01 19:51:04.641|1.1.0.1.46911|Info|push-notifications|Got notification | UserConfirmed
{
  "type": "userConfirmed",
  "eventId": "000000000000000000000006",
  "profileid": "6a8632b90000000000000001",
  "status": "Busy",
  "ip": "10.0.0.1",
  "port": 17004,
  "sid": "XX-XXX00X000_0000_00.00.00_00-00-00",
  "version": "live",
  "location": "Shoreline",
  "raidMode": "Online",
  "mode": "deathmatch",
  "shortId": "AAAAAA",
  "additional_info": []
}`;

export const USER_MATCH_OVER = `2026-09-01 19:51:06.133|1.1.0.1.46911|Info|push-notifications|Got notification | UserMatchOver
{
  "type": "userMatchOver",
  "eventId": "000000000000000000000007"
}`;

/** Squadmate accepted an invite: `Info` at the top level. */
export const GROUP_INVITE_ACCEPT = `2026-09-01 19:28:03.221|1.1.0.1.46911|Info|push-notifications|Got notification | GroupMatchInviteAccept
{
  "type": "groupMatchInviteAccept",
  "eventId": "000000000000000000000008",
  "_id": "000000000000000000000009",
  "aid": 7654321,
  "Info": {
    "Nickname": "Squadmate",
    "Side": "Usec",
    "Level": 16,
    "MemberCategory": 2,
    "GameVersion": "standard"
  }
}`;

/** Squadmate readied up: `Info` nested under `extendedProfile`. */
export const GROUP_RAID_READY = `2026-09-01 19:29:00.000|1.1.0.1.46911|Info|push-notifications|Got notification | GroupMatchRaidReady
{
  "type": "groupMatchRaidReady",
  "eventId": "00000000000000000000000a",
  "extendedProfile": {
    "Info": {
      "Nickname": "Squadmate",
      "Side": "Usec",
      "Level": 16
    },
    "isLeader": false
  }
}`;

/** Local player left the group: payload omits the nickname. */
export const GROUP_USER_LEAVE = `2026-09-01 19:40:00.000|1.1.0.1.46911|Info|push-notifications|Got notification | GroupMatchUserLeave
{
  "type": "groupMatchUserLeave",
  "eventId": "00000000000000000000000b"
}`;

export const GROUP_RAID_SETTINGS = `2026-09-01 19:30:00.000|1.1.0.1.46911|Info|push-notifications|Got notification | GroupMatchRaidSettings
{
  "type": "groupMatchRaidSettings",
  "eventId": "00000000000000000000000c",
  "raidSettings": {
    "location": "Interchange",
    "raidMode": "Online",
    "side": "Pmc"
  }
}`;
