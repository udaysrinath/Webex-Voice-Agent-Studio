# Webex Messages API - Quick Reference Guide

## Overview
The `webex_all_in_one` app uses the **Webex REST API** to download messages from all spaces/rooms. It uses direct HTTP requests (not the SDK) for better control and parallel processing.

## Authentication

### Load Token
```python
import json

def load_token() -> str:
    """Load access token from token.json"""
    with open('token.json') as f:
        token_data = json.load(f)
    return token_data['access_token']
```

The token is a standard OAuth 2.0 Bearer token obtained from Webex.

## Core API Function

### Generic Pagination Handler
```python
import requests
from typing import List, Dict

def paginate_get(endpoint: str, params: Dict, token: str, max_pages: int = 100) -> List[Dict]:
    """
    Generic pagination handler for Webex API
    
    Args:
        endpoint: API endpoint (e.g., 'rooms', 'messages')
        params: Query parameters for first request
        token: OAuth Bearer token
        max_pages: Maximum pages to fetch (default 100)
    
    Returns:
        List of all items from all pages
    """
    headers = {
        'Authorization': f'Bearer {token}',
        'Content-Type': 'application/json'
    }
    
    base_url = 'https://webexapis.com/v1'
    url = f'{base_url}/{endpoint}'
    
    all_items = []
    page = 0
    
    while url and page < max_pages:
        response = requests.get(url, headers=headers, params=params if page == 0 else None)
        response.raise_for_status()
        data = response.json()
        
        items = data.get('items', [])
        all_items.extend(items)
        
        # Get next page link from response
        url = data.get('Link', {}).get('next') if isinstance(data.get('Link'), dict) else None
        page += 1
    
    return all_items
```

## Usage Examples

### 1. Get All Rooms
```python
token = load_token()

# Fetch all rooms/spaces the user has access to
rooms = paginate_get('rooms', {'max': 100}, token)

print(f"Found {len(rooms)} rooms")
for room in rooms[:5]:
    print(f"  - {room['title']} (type: {room['type']})")
```

### 2. Get Messages from a Room
```python
# Get messages from a specific room
room_id = rooms[0]['id']
messages = paginate_get(
    'messages',
    {'roomId': room_id, 'max': 100},
    token,
    max_pages=50  # Limit to 5000 messages (50 pages × 100/page)
)

print(f"Found {len(messages)} messages in room")
```

### 3. Filter Messages by Date
```python
from datetime import datetime, timedelta

start_date = datetime.now() - timedelta(days=30)

recent_messages = []
for msg in messages:
    created_str = msg.get('created', '')
    if created_str:
        created = datetime.fromisoformat(created_str.replace('Z', '+00:00'))
        if created >= start_date.replace(tzinfo=created.tzinfo):
            recent_messages.append(msg)

print(f"Found {len(recent_messages)} messages in last 30 days")
```

### 4. Extract Message Content
```python
for msg in recent_messages:
    # Get text content (try 'text' first, fallback to 'html')
    text = msg.get('text', '') or msg.get('html', '')
    
    # Get metadata
    person_email = msg.get('personEmail', '')
    person_name = msg.get('personDisplayName', 'Unknown')
    created = msg.get('created', '')
    message_id = msg.get('id', '')
    
    print(f"[{created}] {person_name}: {text[:100]}")
```

### 5. Complete Download Workflow
```python
from datetime import datetime, timedelta
from pathlib import Path
import json

def download_messages(days: int = 30):
    """Download all messages from the last N days"""
    token = load_token()
    
    # Calculate date range
    end_date = datetime.now()
    start_date = end_date - timedelta(days=days)
    
    print(f"Downloading messages from {start_date.date()} to {end_date.date()}")
    
    # Step 1: Get all rooms
    print("Fetching rooms...")
    rooms = paginate_get('rooms', {'max': 100}, token)
    
    # Filter rooms with recent activity
    active_rooms = []
    for room in rooms:
        last_activity_str = room.get('lastActivity', '')
        if last_activity_str:
            last_activity = datetime.fromisoformat(last_activity_str.replace('Z', '+00:00'))
            if last_activity >= start_date.replace(tzinfo=last_activity.tzinfo):
                active_rooms.append(room)
    
    print(f"Found {len(active_rooms)} active rooms")
    
    # Step 2: Download messages from each room
    all_messages = []
    output_dir = Path('data/messages')
    output_dir.mkdir(parents=True, exist_ok=True)
    
    for i, room in enumerate(active_rooms, 1):
        room_id = room['id']
        room_title = room.get('title', 'Untitled')
        
        print(f"[{i}/{len(active_rooms)}] {room_title}...")
        
        # Fetch messages
        messages = paginate_get(
            'messages',
            {'roomId': room_id, 'max': 100},
            token,
            max_pages=50
        )
        
        # Filter by date
        filtered = []
        for msg in messages:
            created_str = msg.get('created', '')
            if created_str:
                created = datetime.fromisoformat(created_str.replace('Z', '+00:00'))
                if created >= start_date.replace(tzinfo=created.tzinfo):
                    filtered.append(msg)
        
        if filtered:
            # Save to file
            safe_title = "".join(c for c in room_title if c.isalnum() or c in (' ', '-', '_')).strip()[:50]
            filename = f"{safe_title}_{room_id}.json"
            
            with open(output_dir / filename, 'w') as f:
                json.dump({
                    'room': room,
                    'messages': filtered
                }, f, indent=2)
            
            all_messages.extend(filtered)
            print(f"  ✅ Saved {len(filtered)} messages")
    
    print(f"\n✅ Downloaded {len(all_messages)} total messages from {len(active_rooms)} rooms")
    return all_messages

# Run it
messages = download_messages(days=30)
```

## API Endpoints Reference

### GET /v1/rooms
Get list of all spaces/rooms the user has access to.

**Parameters:**
- `max` (integer, optional): Number of items per page (default: 100, max: 1000)

**Response:**
```json
{
  "items": [
    {
      "id": "Y2lzY29...",
      "title": "My Team Space",
      "type": "group",
      "isLocked": false,
      "lastActivity": "2025-11-18T10:30:00.000Z",
      "creatorId": "Y2lzY29...",
      "created": "2025-01-15T08:00:00.000Z"
    }
  ]
}
```

**Room Types:**
- `direct` - 1:1 direct message
- `group` - Group space (team/project)

### GET /v1/messages
Get messages from a specific room.

**Parameters:**
- `roomId` (string, required): The room ID to fetch messages from
- `max` (integer, optional): Number of messages per page (default: 100, max: 1000)

**Response:**
```json
{
  "items": [
    {
      "id": "Y2lzY29...",
      "roomId": "Y2lzY29...",
      "roomType": "group",
      "text": "Hello team!",
      "personId": "Y2lzY29...",
      "personEmail": "user@example.com",
      "personDisplayName": "John Doe",
      "created": "2025-11-18T10:30:00.000Z"
    }
  ]
}
```

**Message Fields:**
- `text` (string): Plain text content
- `html` (string): HTML formatted content (if available)
- `markdown` (string): Markdown content (if available)
- `files` (array): Attached file URLs
- `created` (ISO 8601 timestamp): When message was created

## Summary

**Key Points:**
1. Use `paginate_get()` to handle automatic pagination
2. Filter rooms by `lastActivity` before downloading messages
3. Filter messages by `created` timestamp after downloading
4. Message content is in `text`, `html`, or `markdown` fields
5. Save messages to JSON files organized by room

**Main Implementation:**
- File: `download_messages.py`
- Entry points: `download_messages(days=150)` or `download_messages_incremental()`
