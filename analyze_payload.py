#!/usr/bin/env python3
"""
Analyze a random payload file from the payload directory.
Extracts unique DOM IDs and classes with counts and sample values.
"""
import os
import random
import json
from pathlib import Path
from collections import Counter, defaultdict
from bs4 import BeautifulSoup


def find_unique_ids_and_classes(html_content):
    """
    Parse HTML and find all unique IDs and classes with counts and samples.
    
    Returns:
        dict with 'ids' and 'classes' containing:
            - unique_value: {'count': int, 'sample': str}
    """
    soup = BeautifulSoup(html_content, 'html.parser')
    
    ids_data = defaultdict(lambda: {'count': 0, 'samples': []})
    classes_data = defaultdict(lambda: {'count': 0, 'samples': []})
    
    # Find all elements with IDs
    for element in soup.find_all(id=True):
        element_id = element.get('id')
        if element_id:
            ids_data[element_id]['count'] += 1
            # Get sample text content (first 100 chars)
            text_sample = element.get_text(strip=True)[:100]
            if text_sample and text_sample not in ids_data[element_id]['samples']:
                ids_data[element_id]['samples'].append(text_sample)
    
    # Find all elements with classes
    for element in soup.find_all(class_=True):
        element_classes = element.get('class', [])
        for cls in element_classes:
            if cls:  # Skip empty strings
                classes_data[cls]['count'] += 1
                # Get sample text content (first 100 chars)
                text_sample = element.get_text(strip=True)[:100]
                if text_sample and text_sample not in classes_data[cls]['samples']:
                    classes_data[cls]['samples'].append(text_sample)
    
    # Convert to final format with single sample
    ids_result = {}
    for id_name, data in ids_data.items():
        ids_result[id_name] = {
            'count': data['count'],
            'sample': data['samples'][0] if data['samples'] else '(no text content)'
        }
    
    classes_result = {}
    for class_name, data in classes_data.items():
        classes_result[class_name] = {
            'count': data['count'],
            'sample': data['samples'][0] if data['samples'] else '(no text content)'
        }
    
    return {
        'ids': ids_result,
        'classes': classes_result
    }


def print_analysis_results(results, filename):
    """Print the analysis results in a formatted way."""
    print("=" * 80)
    print(f"Analysis of: {filename}")
    print("=" * 80)
    
    ids = results['ids']
    classes = results['classes']
    
    print(f"\n📋 UNIQUE DOM IDs: {len(ids)} found\n")
    if ids:
        # Sort by count descending
        sorted_ids = sorted(ids.items(), key=lambda x: x[1]['count'], reverse=True)
        for id_name, data in sorted_ids:
            print(f"  ID: {id_name}")
            print(f"    Count: {data['count']}")
            print(f"    Sample: {data['sample']}")
            print()
    else:
        print("  No IDs found in this file.")
    
    print(f"\n🏷️  UNIQUE DOM CLASSES: {len(classes)} found\n")
    if classes:
        # Sort by count descending
        sorted_classes = sorted(classes.items(), key=lambda x: x[1]['count'], reverse=True)
        for class_name, data in sorted_classes:
            print(f"  Class: {class_name}")
            print(f"    Count: {data['count']}")
            print(f"    Sample: {data['sample']}")
            print()
    else:
        print("  No classes found in this file.")
    
    print("=" * 80)
    
    # Summary statistics
    print("\n📊 SUMMARY:")
    print(f"  Total unique IDs: {len(ids)}")
    print(f"  Total unique classes: {len(classes)}")
    if ids:
        total_id_occurrences = sum(data['count'] for data in ids.values())
        print(f"  Total ID occurrences: {total_id_occurrences}")
    if classes:
        total_class_occurrences = sum(data['count'] for data in classes.values())
        print(f"  Total class occurrences: {total_class_occurrences}")
    print("=" * 80)


def main():
    # Get payload directory path
    script_dir = Path(__file__).parent
    payload_dir = script_dir / "data" / "payload"
    
    if not payload_dir.exists():
        print(f"Error: Payload directory not found at {payload_dir}")
        return
    
    # Get all JSON files in payload directory
    payload_files = list(payload_dir.glob("*.json"))
    
    if not payload_files:
        print(f"Error: No payload files found in {payload_dir}")
        return
    
    # Randomly select a file
    selected_file = random.choice(payload_files)
    print(f"🎲 Randomly selected file: {selected_file.name}\n")
    
    # Read the file
    try:
        with open(selected_file, 'r', encoding='utf-8') as f:
            content = f.read()
    except Exception as e:
        print(f"Error reading file: {e}")
        return
    
    # Check if it's HTML or JSON
    content_stripped = content.strip()
    if content_stripped.startswith('<') or content_stripped.startswith('<!DOCTYPE'):
        # It's HTML
        html_content = content
    elif content_stripped.startswith('{'):
        # It's JSON, might contain HTML
        try:
            data = json.loads(content)
            if isinstance(data, str):
                html_content = data
            elif isinstance(data, dict) and 'html' in data:
                html_content = data['html']
            else:
                # Try to find HTML in the JSON
                html_content = str(data)
        except:
            html_content = content
    else:
        # Assume it's HTML
        html_content = content
    
    # Analyze the HTML
    results = find_unique_ids_and_classes(html_content)
    
    # Print results
    print_analysis_results(results, selected_file.name)
    
    # Optional: Save results to JSON
    output_file = script_dir / "data" / f"analysis_{selected_file.stem}.json"
    output_file.parent.mkdir(parents=True, exist_ok=True)
    
    results_for_json = {
        'analyzed_file': selected_file.name,
        'ids': results['ids'],
        'classes': results['classes']
    }
    
    with open(output_file, 'w', encoding='utf-8') as f:
        json.dump(results_for_json, f, indent=2, ensure_ascii=False)
    
    print(f"\n💾 Results also saved to: {output_file}")


if __name__ == "__main__":
    main()

