use rbx_xml::{DecodeOptions, DecodePropertyBehavior};
use serde_json::{json, Map, Value};
fn has_null(value: &Value) -> bool {
    match value {
        Value::Null => true,
        Value::Array(a) => a.iter().any(has_null),
        Value::Object(o) => o.values().any(has_null),
        _ => false,
    }
}
fn numeric_null(value: &Value) -> bool {
    match value {
        Value::Array(a) => a.iter().any(numeric_null),
        Value::Object(o) => o.iter().any(|(k, v)| {
            ((matches!(
                k.as_str(),
                "Float32"
                    | "Float64"
                    | "Vector2"
                    | "Vector3"
                    | "CFrame"
                    | "Color3"
                    | "Rect"
                    | "NumberRange"
                    | "NumberSequence"
                    | "ColorSequence"
                    | "PhysicalProperties"
            )) && has_null(v))
                || numeric_null(v)
        }),
        _ => false,
    }
}
fn exact_integers(value: &mut Value) {
    match value {
        Value::Number(n) => {
            if n.is_i64() {
                let i = n.as_i64().unwrap();
                if i.unsigned_abs() > 9_007_199_254_740_991 {
                    *value = json!({"int64":i.to_string()});
                }
            } else if n.is_u64() {
                let i = n.as_u64().unwrap();
                if i > 9_007_199_254_740_991 {
                    *value = json!({"uint64":i.to_string()});
                }
            }
        }
        Value::Array(a) => {
            for v in a {
                exact_integers(v)
            }
        }
        Value::Object(o) => {
            for v in o.values_mut() {
                exact_integers(v)
            }
        }
        _ => {}
    }
}
fn property_names(class_name: &str, raw: &str) -> Vec<String> {
    use rbx_reflection::{PropertyKind, PropertySerialization};
    let mut names = vec![raw.to_owned()];
    if let Ok(database) = rbx_reflection_database::get() {
        if let Some(class) = database.classes.get(class_name) {
            for class in database.superclasses_iter(class) {
                for property in class.properties.values() {
                    match &property.kind {
                        PropertyKind::Alias { alias_for } if property.name == raw => {
                            names.push((*alias_for).to_owned())
                        }
                        PropertyKind::Canonical {
                            serialization: PropertySerialization::SerializesAs(name),
                        } if *name == raw => names.push(property.name.to_owned()),
                        PropertyKind::Canonical {
                            serialization: PropertySerialization::Migrate(migration),
                        } if property.name == raw => names.extend(
                            migration
                                .new_property_names()
                                .iter()
                                .map(|v| (*v).to_owned()),
                        ),
                        _ => {}
                    }
                }
            }
        }
    }
    names
}
pub fn decode(bytes: &[u8]) -> Result<Value, String> {
    crate::warnings::reset();
    let binary = bytes.starts_with(b"<roblox!");
    let (items, mut diagnostics) = if binary {
        (Vec::new(), Vec::new())
    } else {
        crate::inventory::inspect(std::str::from_utf8(bytes).map_err(|e| e.to_string())?)?
    };
    let dom = if binary {
        rbx_binary::from_reader(bytes).map_err(|e| e.to_string())?
    } else {
        rbx_xml::from_reader(
            bytes,
            DecodeOptions::new().property_behavior(DecodePropertyBehavior::ReadUnknown),
        )
        .map_err(|e| e.to_string())?
    };
    let mut instances = Vec::new();
    let mut stack = vec![(dom.root_ref(), None::<String>)];
    let mut index = 0;
    while let Some((id, parent)) = stack.pop() {
        let i = dom.get_by_ref(id).ok_or("Invalid DOM reference")?;
        let synthetic = parent.is_none();
        let mut properties = Map::new();
        for (key, value) in &i.properties {
            let v = if let rbx_types::Variant::Ref(target) = value {
                json!({"type":"Ref","value":if target.is_some(){Some(target.to_string())}else{None}})
            } else if let rbx_types::Variant::Float64(number) = value {
                json!({"type":"Float64","value":if number.is_finite(){json!(number)}else{json!({"nonFinite":if number.is_nan(){"NaN"}else if *number<0.0{"-Infinity"}else{"Infinity"}})}})
            } else if let rbx_types::Variant::Float32(number) = value {
                json!({"type":"Float32","value":if number.is_finite(){json!(number)}else{json!({"nonFinite":if number.is_nan(){"NaN"}else if *number<0.0{"-Infinity"}else{"Infinity"}})}})
            } else {
                let mut v = serde_json::to_value(value).map_err(|e| e.to_string())?;
                if numeric_null(&v) {
                    diagnostics.push(json!({"code":"NON_FINITE_PROPERTY","severity":"warning","message":format!("{} contains non-finite numeric components; original XML retained",key)}));
                    json!({"type":"unmodeled","value":{"unmodeledNonFinite":true},"unsupported":true})
                } else {
                    exact_integers(&mut v);
                    if let Some(obj) = v.as_object() {
                        if obj.len() == 1 {
                            let (t, v) = obj.iter().next().unwrap();
                            json!({"type":t,"value":v})
                        } else {
                            json!({"type":"value","value":v})
                        }
                    } else {
                        json!({"type":"value","value":v})
                    }
                }
            };
            properties.insert(key.to_string(), v);
        }
        let raw = if synthetic {
            None
        } else {
            let v = items.get(index);
            index += 1;
            v
        };
        if index > 200_000 {
            return Err("INSTANCE_LIMIT".into());
        }
        if let Some(raw) = raw {
            if let Some(raw_properties) = raw["properties"].as_array() {
                for property in raw_properties {
                    let name = property["name"].as_str().unwrap_or("");
                    if name == "Name" {
                        continue;
                    }
                    let names = property_names(i.class.as_str(), name);
                    let decoded = names
                        .iter()
                        .find_map(|name| i.properties.get(&name.as_str().into()));
                    if decoded.is_none() {
                        diagnostics.push(json!({"code":"PROPERTY_NOT_RETAINED","severity":"warning","ownerId":id.to_string(),"message":format!("Serialized property {} was not retained by the decoder; raw input preserved",name)}));
                    }
                    if name == "AttributesSerialize"
                        && !matches!(decoded, Some(rbx_types::Variant::Attributes(_)))
                    {
                        diagnostics.push(json!({"code":"PROPERTY_DECODE_FALLBACK","severity":"warning","ownerId":id.to_string(),"message":"AttributesSerialize could not be decoded as attributes; original bytes preserved"}));
                    }
                }
            }
        }
        instances.push(json!({"id":id.to_string(),"parentId":parent,"name":i.name.as_str(),"className":i.class.as_str(),"properties":properties,"synthetic":synthetic,"originalReferent":raw.and_then(|v|v.get("referent"))}));
        for child in i.children().iter().rev() {
            stack.push((*child, Some(id.to_string())));
        }
    }
    let declared = if binary {
        bytes
            .get(20..24)
            .map(|b| u32::from_le_bytes(b.try_into().unwrap()) as usize)
            .unwrap_or(0)
    } else {
        items.len()
    };
    if index != declared {
        diagnostics.push(json!({"code":"INVENTORY_MISMATCH","severity":"error","message":"Decoded object count differs from raw inventory"}));
    }
    diagnostics.extend(crate::warnings::take());
    Ok(
        json!({"instances":instances,"inventory":{"items":items,"format":if binary{"rbxl"}else{"rbxlx"}},"diagnostics":diagnostics,"importerVersion":env!("CARGO_PKG_VERSION"),"serializationVersion":3}),
    )
}
