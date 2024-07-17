'use strict';

const mysql = require("mysql");
const { resolve } = require("path");
const { rejects } = require("assert");
const axios = require('axios');
const fs = require('fs');
const yaml = require('js-yaml');
const dotenv = require('dotenv');

const fileContents = fs.readFileSync('./env.yml', 'utf8');
const configdata = yaml.load(fileContents);

const pool = mysql.createPool({
  host: configdata.host,
  user: configdata.user,
  password: configdata.password,
  database: configdata.database,
});


module.exports.appblueccpostnode = async (event) => {


  const Result = await GetPaymentDetailsFromDb();
  let broker_id = "";
  let  Todoid = "";  
  let Todoids = [];
  let customefiledid = "";
  let customefiledids = [];
  let sales_id = "";
  const count = Result.length;
  for (let i = 0; i < count; i++) {
    const Todoname = Result[i].title
    const Tblid = Result[i].id
    sales_id = Result[i].sale_id
    broker_id = Result[i].broker_id
    let todoResponse = await CreateTodo(Todoname);
    Todoid = todoResponse.data.createTodo.id;
    Todoids.push(todoResponse.data.createTodo.id); 
    // this method is update todo id in table 
      await EnterTodoIdInTbl(Todoname,Tblid,Todoid);

      // Get List Of Todos
      const customFields_response = await LoadTodoFileds(Todoid);

      const customFields = customFields_response.data.todoQueries.todos.items.flatMap(item => item.customFields);
      //console.log("customFields",customFields);
      const customFieldsNoSpaces = customFields.map(field => {
        return {
          ...field,
          name: field.name.replace(/\s+/g, '_') // Replace spaces with underscores
        };
      });

     
      const DB_Values = await GetPaymentDetailsById(Tblid);

      const { results, fields } = DB_Values;

      const fieldNames = fields.map(field => field.name);  // this only database fileds

      // Created All Filed We Required this filed updated in blue matching from samed id
      const filedstosend = [
        'address_1','address_2','City','State','Zipcode','Affiliate_Code',
        'First_Name','Last_Name','Country','Fax','Company','Created_Date',
        'Marketing_Authorization','Institution_Code', 'Email','Phone_number',
        'coupon_code','Sales_ID'
      ]
      const filteredData = {
        results: results.map(result => {
          const filteredResult = {};
          filedstosend.forEach(fieldName => {
            filteredResult[fieldName] = result[fieldName];
          });
          return filteredResult;
        }),
        fields: fields.map(field => ({
          name: field.name
        }))
      };
     const Fileds = filteredData.fields;  // this only database fileds
     let BlueArrayCC = [];
     filedstosend.forEach(element => {
          const idObj = customFieldsNoSpaces.find(field => field.name.toLowerCase() === element.toLowerCase());
          const id = idObj ? idObj.id : '';
          if (element === "Institution_Code") {
            customefiledid = id ;
            customefiledids.push(id); 
          }
          const value = results[0][element] !== undefined ? results[0][element] : null;
            BlueArrayCC.push({ id, name: element, value });
        });
            
            //console.log("BlueArrayCC",BlueArrayCC);
            await FillDataBlueCC(Todoid,Tblid,BlueArrayCC);        

    }
    
    // for update of Institution Code
    for (const todoId of Todoids) {
      const customefiledsvalues = await LoadTodoFiledsCustomeId(todoId);
      const customFieldsWithValues = customefiledsvalues.data.todoQueries.todos.items.reduce((acc, todo) => {
        const fieldsWithValues = todo.customFields.filter(field => field.name === "Institution Code" && field.customFieldOptions.length > 0);
        return acc.concat(fieldsWithValues);
      }, []);
      
      const institutionCodeFieldOptions = customFieldsWithValues[0].customFieldOptions.map(option => ({
        id: option.id,
        title: option.title
      }));
      
      if (broker_id==="C010025282") {
        await UpdateCustomFieldValue(todoId,customefiledid,institutionCodeFieldOptions[1].id);       
  
      }
      if (broker_id==="SU10025292") {
        await UpdateCustomFieldValue(todoId,customefiledid,institutionCodeFieldOptions[0].id);           
        }
    }
    
  return {
    statusCode: 200,
    body: JSON.stringify(
      {
        message: 'Go Serverless v1.0! Your function executed successfully!',
        input: event,
      },
      null,
      2
    ),
  }; 
};

async function GetPaymentDetailsFromDb()
{
  return new Promise(async (resolve, rejects) => {
    const timestamp = Date.now();
    const date = new Date(timestamp);
    let sqlquery = `SELECT id, concat(payer_first_name," ",payer_last_name) as title, product_id,  product_name, test_mode, sale_id, payment_gateway, payment_amount, DATE_FORMAT(payment_time, '%d/%m/%Y') as payment_time,  payer_email, payer_first_name, payer_last_name, payer_address_street, payer_address_city, payer_address_state,payer_address_zip,country,payer_phone,broker_id FROM ETX_Prod where updated_in_blue = 0`;
    pool.getConnection(async (err, connection) => {
      if (err) {
        console.log(err);
        return rejects(err);
      }
      await connection.query(sqlquery, async (error, results, fields) => {
        connection.release();
        if (error) {
          console.error("Error querying MySQL:", error);
          return rejects(error);
        }
        return resolve(results);
      });
    });
  });
}


// this is important to send data from blue using filed name
async function GetPaymentDetailsById(Tblid)
{
  return new Promise(async (resolve, rejects) => {
    const timestamp = Date.now();
    const date = new Date(timestamp);
    let sqlquery = `select payer_address_street as address_1 ,payer_address_city as City,payer_address_state as State,payer_address_zip as Zipcode,payer_first_name as First_Name,payer_last_name as Last_Name, payer_email as Email, payer_phone as Phone_number , broker_id as Institution_Code, country as Country, coupon_code as coupon_code , sale_id as Sales_ID  FROM ETX_Prod where id = ${Tblid};`;
    pool.getConnection(async (err, connection) => {
      if (err) {
        console.log(err);
        return rejects(err);
      }
      await connection.query(sqlquery, async (error, results, fields) => {
        var Response = {
          results,
          fields
        }
        connection.release();
        if (error) {
          console.error("Error querying MySQL:", error);
          return rejects(error);
        }
        return resolve(Response);
      });
    });
  });
}

async function CreateTodo(todoname)
{
  return new Promise((resolve,rejects)=>{
    
      let data = JSON.stringify({
        query: `mutation CreateRecord {
            createTodo(input: {
                title: "${todoname}",
                position: 2
            }) {
                title
                position
                id
            }
        }`
    });
      
      let config = {
        method: 'post',
        maxBodyLength: Infinity,
        url: 'https://api.blue.cc/graphql',
        headers: { 
          'Accept-Encoding': 'gzip, deflate, br', 
          'Content-Type': 'application/json', 
          'Accept': 'application/json', 
          'Connection': 'keep-alive', 
          'DNT': '1', 
          'Origin': 'https://app.blue.cc', 
          'X-Bloo-Token-ID': configdata.XToken, 
          'X-Bloo-Token-Secret': configdata.XSecret, 
          'X-Bloo-Company-ID': configdata.XCompanyID, 
          'X-Bloo-Project-ID': configdata.XProjectID
        },
        data : data
      };
      
      axios.request(config)
      .then((response) => {
        console.log(JSON.stringify(response.data));
        resolve(response.data);
      })
      .catch((error) => {
        console.log(error);
        rejects(error);
      }); 
  });
}

async function EnterTodoIdInTbl(Todoname,Tblid,Todoid)
{
  return new Promise(async (resolve, rejects) => {
    const timestamp = Date.now();
    const date = new Date(timestamp);
    let sqlquery = `update ETX_Prod set todoname = '${Todoname}', todoid = '${Todoid}' where id = ${Tblid} `;
    pool.getConnection(async (err, connection) => {
      if (err) {
        console.log(err);
        return rejects(err);
      }
      await connection.query(sqlquery, async (error, results, fields) => {
        connection.release();
        if (error) {
          console.error("Error querying MySQL:", error);
          return rejects(error);
        }
        return resolve(results);
      });
    });
  });
}

async function LoadTodoFileds(todoIds)
{  
   try {
    return new Promise((resolve,rejects)=>{
      const listRecordsQuery = `
      query ListOfRecordsWithinProject {
          todoQueries {
              todos(
                  filter: {
                      companyIds: "${configdata.XCompanyID}",
                      projectIds: "${configdata.XProjectID}",
                      todoIds: "${todoIds}"
                  }
              ) {
                  items {
                      id
                      title
                      customFields {
                          id
                          name                          
                      }
                  }
              }
          }
      }
  `;
  const listRecordsData = JSON.stringify({ query: listRecordsQuery });
  let config = {
          method: 'post',
          maxBodyLength: Infinity,
          url: 'https://api.blue.cc/graphql',
          headers: { 
            'Accept-Encoding': 'gzip, deflate, br', 
            'Content-Type': 'application/json', 
            'Accept': 'application/json', 
            'Connection': 'keep-alive', 
            'DNT': '1', 
            'Origin': 'https://app.blue.cc', 
            'X-Bloo-Token-ID': configdata.XToken, 
            'X-Bloo-Token-Secret': configdata.XSecret, 
            'X-Bloo-Company-ID': configdata.XCompanyID, 
            'X-Bloo-Project-ID': configdata.XProjectID
          },
          data : listRecordsData
        };    
        axios.request(config)
        .then((response) => {
          //console.log(JSON.stringify(response.data));
          resolve(response.data);
        })
        .catch((error) => {
          console.log(error);
          rejects(error);
        }); 
        
    })
   } catch (error) {
    console.log(error);
    rejects(error);
  }
}

async function LoadTodoFiledsCustomeId(todoIds)
{  
   try {
    return new Promise((resolve,rejects)=>{
      const listRecordsQuery = `
      query ListOfRecordsWithinProject {
          todoQueries {
              todos(
                  filter: {
                      companyIds: "${configdata.XCompanyID}",
                      projectIds: "${configdata.XProjectID}",
                      todoIds: "${todoIds}"
                  }
              ) {
                  items {                      
                      customFields {          
                        name
                        id
                          customFieldOptions{
                            id
                            title
                          }
                      }
                  }
              }
          }
      }
  `;
  const listRecordsData = JSON.stringify({ query: listRecordsQuery });
  let config = {
          method: 'post',
          maxBodyLength: Infinity,
          url: 'https://api.blue.cc/graphql',
          headers: { 
            'Accept-Encoding': 'gzip, deflate, br', 
            'Content-Type': 'application/json', 
            'Accept': 'application/json', 
            'Connection': 'keep-alive', 
            'DNT': '1', 
            'Origin': 'https://app.blue.cc', 
            'X-Bloo-Token-ID': configdata.XToken, 
            'X-Bloo-Token-Secret': configdata.XSecret, 
            'X-Bloo-Company-ID': configdata.XCompanyID, 
            'X-Bloo-Project-ID': configdata.XProjectID
          },
          data : listRecordsData
        };    
        axios.request(config)
        .then((response) => {
          //console.log(JSON.stringify(response.data));
          resolve(response.data);
        })
        .catch((error) => {
          console.log(error);
          rejects(error);
        }); 
        
    })
   } catch (error) {
    console.log(error);
    rejects(error);
  }
}
async function FillDataBlueCC(Todoid,Tblid,BlueArrayCC)
{
  try {
    for (const element of BlueArrayCC) {
      console.log("cus id", element);
      if (element.value != null && element.value !== "") {
        if (element.name === 'Institution_Code') {
          console.log("here is only text filed update !");
        }
        else
        {
          const mutation = `
          mutation UpdateExistingRecordSingleLineTextCustomField {
            setTodoCustomField(
              input: {
                todoId: "${Todoid}"
                customFieldId: "${element.id}",
                text: "${element.value}"
              }
            )
          }
        `;

        const mutationData = JSON.stringify({ query: mutation });

        const config = {
          method: 'post',
          maxBodyLength: Infinity,
          url: 'https://api.blue.cc/graphql',
          headers: {
            'Accept-Encoding': 'gzip, deflate, br',
            'Content-Type': 'application/json',
            'Accept': 'application/json',
            'Connection': 'keep-alive',
            'DNT': '1',
            'Origin': 'https://app.blue.cc',
            'X-Bloo-Token-ID': configdata.XToken, 
            'X-Bloo-Token-Secret': configdata.XSecret, 
            'X-Bloo-Company-ID': configdata.XCompanyID, 
            'X-Bloo-Project-ID': configdata.XProjectID
          },
          data: mutationData
        };

              // Wait for each API call to complete before proceeding to the next
              const response = await axios.request(config);
              console.log('Mutation response:', response.data);
        }        
      }
    }
    
            await UpdateStatus(Tblid)
    resolve();
  } catch (error) {
    console.error('Error updating custom field:', error);
    throw error;
  }
}

async function UpdateCustomFieldValue(Todoid, customFieldId, customFieldOptionId) {
  return new Promise(async (resolve, reject) => {
    if (customFieldId) {
      try {
        const mutation = `
          mutation UpdateExistingRecordSingleLineTextCustomField {
            setTodoCustomField(
              input: {
                todoId: "${Todoid}"
                customFieldId: "${customFieldId}",
                customFieldOptionId: "${customFieldOptionId}"
              }
            )
          }
        `;

        const mutationData = JSON.stringify({ query: mutation });

        const config = {
          method: 'post',
          maxBodyLength: Infinity,
          url: 'https://api.blue.cc/graphql',
          headers: {
            'Accept-Encoding': 'gzip, deflate, br',
            'Content-Type': 'application/json',
            'Accept': 'application/json',
            'Connection': 'keep-alive',
            'DNT': '1',
            'Origin': 'https://app.blue.cc',
            'X-Bloo-Token-ID': configdata.XToken, 
            'X-Bloo-Token-Secret': configdata.XSecret, 
            'X-Bloo-Company-ID': configdata.XCompanyID, 
            'X-Bloo-Project-ID': configdata.XProjectID
          },
          data: mutationData
        };

        const response = await axios.request(config);
        console.log('Mutation response:', response.data);
        resolve(response.data);

      } catch (error) {
        console.error('Error updating custom field:', error);
        reject(error);
      }
    } else {
      console.log("Custom Field ID does not exist!");
      reject(new Error("Custom Field ID does not exist!"));
    }
  });
}

async function UpdateStatus(Tblid,sales_id)
{
  return new Promise(async (resolve, rejects) => {
    const timestamp = Date.now();
    const date = new Date(timestamp);
    let sqlquery = `update ETX_Prod set updated_in_blue = 1 where id = ${Tblid}`;
    pool.getConnection(async (err, connection) => {
      if (err) {
        console.log(err);
        return rejects(err);
      }
      await connection.query(sqlquery, async (error, results, fields) => {
        connection.release();
        if (error) {
          console.error("Error querying MySQL:", error);
          return rejects(error);
        }
        return resolve(results);
      });
    });
  });  
}

