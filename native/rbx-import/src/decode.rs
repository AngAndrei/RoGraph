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
pub fn decode(xml: &str) -> Result<Value, String> {
    let (items, mut diagnostics) = crate::inventory::inspect(xml)?;
    let dom = rbx_xml::from_reader(
        xml.as_bytes(),
        DecodeOptions::new().property_behavior(DecodePropertyBehavior::ReadUnknown),
    )
    .map_err(|e| e.to_string())?;
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
        instances.push(json!({"id":id.to_string(),"parentId":parent,"name":i.name.as_str(),"className":i.class.as_str(),"properties":properties,"synthetic":synthetic,"originalReferent":raw.and_then(|v|v.get("referent"))}));
        for child in i.children().iter().rev() {
            stack.push((*child, Some(id.to_string())));
        }
    }
    if index != items.len() {
        diagnostics.push(json!({"code":"INVENTORY_MISMATCH","severity":"error","message":"Decoded object count differs from raw inventory"}));
    }
    Ok(
        json!({"instances":instances,"inventory":{"items":items},"diagnostics":diagnostics,"importerVersion":env!("CARGO_PKG_VERSION"),"serializationVersion":2}),
    )
}
